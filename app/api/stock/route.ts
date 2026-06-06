import { NextRequest, NextResponse } from 'next/server'
import { validateProvider } from '@/lib/validation'
import { callStockSQLLLM, callStockLLM, ALL_PROVIDERS } from '@/lib/llm'
import * as libsql from '@libsql/client'

// ── Turso 클라이언트 ────────────────────────────────
function getTursoClient() {
  return libsql.createClient({
    url:       process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  })
}

// ── SQL 안전 검증 (SELECT만 허용) ───────────────────
function validateSQL(sql: string): void {
  const normalized = sql.trim().toUpperCase()
  if (!normalized.startsWith('SELECT')) {
    throw new Error('SELECT 쿼리만 허용됩니다.')
  }
  const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE']
  for (const kw of forbidden) {
    if (normalized.includes(kw)) {
      throw new Error(`허용되지 않는 SQL 키워드: ${kw}`)
    }
  }
}

// ── 1단계: 질문 → SQL + display 타입 결정 ──────────
const SQL_SYSTEM_PROMPT = `너는 주식 데이터 SQL 전문가야. 사용자 질문을 SQLite SQL로 변환해.

테이블 구조:
  stock_prices (ticker TEXT, market TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, volume INTEGER)
  stocks (ticker TEXT, name TEXT, market TEXT)

종목명으로 검색할 때는 반드시 stocks 테이블과 JOIN해서 ticker를 찾아야 해:
  SELECT sp.* FROM stock_prices sp
  JOIN stocks s ON sp.ticker = s.ticker AND sp.market = s.market
  WHERE s.name LIKE '%삼성전자%'

규칙:
- 반드시 JSON만 반환 (다른 텍스트 없이):
  { "sql": "...", "explainable": true, "display": "chat" }
- display 값 결정:
  "chat"       → 단순 사실 질문 (종가 하나, 특정 날짜 1개 값 등)
  "table"      → 여러 행 데이터 (기간별 주가, 순위, 비교 등)
  "table+chart"→ 시계열 데이터 (1주일 이상 기간, 추세 파악용)
  "ask"        → 데이터는 있는데 표현 방식이 애매한 경우 (사용자에게 물어봄)
- SELECT만 사용, LIMIT 최대 100
- 날짜는 오늘 기준 계산 (오늘: ${new Date().toISOString().split('T')[0]})
- 최근 1개월: date >= date('now', '-1 month')
- 최근 1주일: date >= date('now', '-7 days')
- 데이터로 답할 수 없는 질문이면: { "sql": null, "explainable": false, "display": "chat" }`

// ── 3단계: 데이터 → 자연어 답변 프롬프트 ──────────
function buildAnswerPrompt(question: string, sql: string, rows: any[], display: string): string {
  const displayHint = display === 'table+chart' || display === 'table'
    ? '\n- 데이터는 테이블/차트로 별도 표시되므로 숫자를 일일이 나열하지 말고 전체 흐름/특징 위주로 요약해줘'
    : ''

  return `너는 주식 비서야. 아래 데이터를 바탕으로 사용자 질문에 친절하게 답해줘.

규칙:
- 투자 권유 절대 금지, 정보 제공만
- 숫자는 읽기 쉽게 포맷 (예: 78,500원, 1,234,567주)
- 데이터가 없으면 솔직하게 말해
- 한국어로 답해${displayHint}

사용자 질문: ${question}
실행된 SQL: ${sql}
조회 결과 (${rows.length}행):
${JSON.stringify(rows.slice(0, 20), null, 2)}${rows.length > 20 ? `\n...(총 ${rows.length}행)` : ''}`
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { messages, action, provider } = body
  const validProvider = validateProvider(provider)

  // ── save_session ────────────────────────────────
  if (action === 'save_session') {
    try {
      const result = await callStockLLM(
        [{
          role: 'user',
          content: `다음 대화를 분석해서 JSON만 반환해. 다른 텍스트 없이 JSON만.
{ "summary": "오늘 대화 내용 한 줄 요약", "notes": "특이사항" }
대화: ${messages.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join('\n')}`,
        }],
        '',
        validProvider
      )
      const parsed = JSON.parse(result.content.replace(/```json|```/g, '').trim())
      return NextResponse.json({ ok: true, log: { date: new Date().toISOString().split('T')[0], ...parsed } })
    } catch (err) {
      console.error('Save session error:', err)
      return NextResponse.json({ ok: false, error: '요약 파싱 실패' })
    }
  }

  // ── 일반 채팅 (Text-to-SQL) ──────────────────────
  try {
    const userQuestion = messages[messages.length - 1]?.content ?? ''

    // 1단계: SQL + display 결정 (멀티턴 맥락 포함 — 최근 6개 메시지)
    const recentMessages = messages.slice(-6).map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))
    const sqlResult = await callStockSQLLLM(
      recentMessages,
      SQL_SYSTEM_PROMPT
    )

    let parsed: { sql: string | null; explainable: boolean; display: string }
    try {
      parsed = JSON.parse(sqlResult.content.replace(/```json|```/g, '').trim())
    } catch {
      parsed = { sql: null, explainable: false, display: 'chat' }
    }

    // display === 'ask': 표현 방식 사용자에게 확인
    if (parsed.display === 'ask') {
      return NextResponse.json({
        content: '어떻게 보여드릴까요?',
        display: 'ask',
        displayOptions: ['채팅', '테이블', '그래프'],
        provider: validProvider,
        availableProviders: ALL_PROVIDERS,
        dataSource: 'ask',
        pendingSql: parsed.sql,
      })
    }

    // SQL 없는 질문 (일반 주식 지식 등)
    if (!parsed.sql || !parsed.explainable) {
      const fallbackPrompt = `너는 주식 비서야. 투자 권유 없이 정보만 제공해. 한국어로 답해.
참고: DB에는 약 3년치 KOSPI/KOSDAQ/NASDAQ/NYSE 일별 OHLCV 데이터가 있음. 실시간 데이터는 없음.`
      const result = await callStockLLM(messages, fallbackPrompt, validProvider)
      return NextResponse.json({
        content: result.content,
        display: 'chat',
        provider: result.provider,
        availableProviders: ALL_PROVIDERS,
        dataSource: 'llm',
      })
    }

    // SQL 검증
    validateSQL(parsed.sql)

    // 2단계: Turso 쿼리 실행
    const client = getTursoClient()
    let rows: any[] = []
    try {
      const rs = await client.execute(parsed.sql)
      rows = rs.rows.map(row => {
        const obj: Record<string, any> = {}
        rs.columns.forEach((col, i) => { obj[col] = row[i] })
        return obj
      })
    } finally {
      client.close()
    }

    // 3단계: 자연어 답변
    const answerPrompt = buildAnswerPrompt(userQuestion, parsed.sql, rows, parsed.display)
    const result = await callStockLLM(
      [{ role: 'user', content: answerPrompt }],
      '',
      validProvider
    )

    return NextResponse.json({
      content: result.content,
      display: parsed.display,
      rows,
      provider: result.provider,
      availableProviders: ALL_PROVIDERS,
      dataSource: 'turso',
      rowCount: rows.length,
    })

  } catch (err) {
    console.error('Stock chat error:', err)
    const errMsg = String(err)
    const isSQL = errMsg.includes('SQL') || errMsg.includes('sqlite')
    return NextResponse.json({
      content: isSQL
        ? '죄송해요, 해당 데이터를 조회하는 데 문제가 생겼어요. 질문을 좀 더 구체적으로 해주시면 다시 시도할게요.'
        : '오류가 발생했어요. 잠시 후 다시 시도해주세요.',
      display: 'chat',
      provider: validProvider,
      availableProviders: ALL_PROVIDERS,
    }, { status: 200 })
  }
}
