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

// ── 1단계: 질문 → SQL 생성 프롬프트 ────────────────
const SQL_SYSTEM_PROMPT = `너는 주식 데이터 SQL 전문가야. 사용자 질문을 SQLite SQL로 변환해.

테이블: stock_prices
컬럼:
  symbol  TEXT  -- 종목코드 (예: 005930, AAPL)
  market  TEXT  -- KOSPI | KOSDAQ | NASDAQ | NYSE
  date    TEXT  -- YYYY-MM-DD
  name    TEXT  -- 종목명 (예: 삼성전자, Apple Inc.)
  open    REAL  -- 시가
  high    REAL  -- 고가
  low     REAL  -- 저가
  close   REAL  -- 종가
  volume  INTEGER -- 거래량

규칙:
- 반드시 JSON만 반환: { "sql": "...", "explainable": true }
- SELECT만 사용, LIMIT 최대 100
- 종목명 검색은 LIKE '%검색어%' 사용
- 날짜는 오늘 기준으로 계산 (오늘: ${new Date().toISOString().split('T')[0]})
- 이번주: date >= date('now', 'weekday 0', '-7 days')
- 지난달: date >= date('now', 'start of month', '-1 month')
- 데이터로 답할 수 없는 질문이면: { "sql": null, "explainable": false }
- 거래량 상위 등 순위 질문은 ORDER BY + LIMIT 활용`

// ── 3단계: 데이터 → 자연어 답변 프롬프트 ──────────
function buildAnswerPrompt(question: string, sql: string, rows: any[]): string {
  return `너는 주식 비서야. 아래 데이터를 바탕으로 사용자 질문에 친절하게 답해줘.

규칙:
- 투자 권유 절대 금지, 정보 제공만
- 숫자는 읽기 쉽게 포맷 (예: 78,500원, 1,234,567주)
- 데이터가 없으면 솔직하게 말해
- 한국어로 답해

사용자 질문: ${question}
실행된 SQL: ${sql}
조회 결과 (${rows.length}행):
${JSON.stringify(rows, null, 2)}`
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
          content: `다음 대화를 분석해서 JSON만 반환해.
{ "summary": "오늘 대화 내용 한 줄 요약", "notes": "특이사항", "weak_points": [] }
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

    // 1단계: SQL 생성 (llama-3.1-8b-instant)
    const sqlResult = await callStockSQLLLM(
      [{ role: 'user', content: userQuestion }],
      SQL_SYSTEM_PROMPT
    )

    let parsed: { sql: string | null; explainable: boolean }
    try {
      parsed = JSON.parse(sqlResult.content.replace(/```json|```/g, '').trim())
    } catch {
      // JSON 파싱 실패 시 일반 LLM 답변으로 폴백
      parsed = { sql: null, explainable: false }
    }

    // SQL 없는 질문 (일반 주식 지식 등)
    if (!parsed.sql || !parsed.explainable) {
      const fallbackPrompt = `너는 주식 비서야. 투자 권유 없이 정보만 제공해. 한국어로 답해.
참고: 실시간/최신 주가 데이터는 없음. 일반 지식 기반으로만 답해.`
      const result = await callStockLLM(messages, fallbackPrompt, validProvider)
      return NextResponse.json({
        content: result.content,
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

    // 3단계: 자연어 답변 (사용자 선택 provider)
    const answerPrompt = buildAnswerPrompt(userQuestion, parsed.sql, rows)
    const result = await callStockLLM(
      [{ role: 'user', content: answerPrompt }],
      '',
      validProvider
    )

    return NextResponse.json({
      content: result.content,
      provider: result.provider,
      availableProviders: ALL_PROVIDERS,
      dataSource: 'turso',
      rowCount: rows.length,
    })

  } catch (err) {
    console.error('Stock chat error:', err)

    // SQL 에러 시 사용자 친화적 메시지
    const errMsg = String(err)
    const isSQL = errMsg.includes('SQL') || errMsg.includes('sqlite')
    return NextResponse.json({
      content: isSQL
        ? '죄송해요, 해당 데이터를 조회하는 데 문제가 생겼어요. 질문을 좀 더 구체적으로 해주시면 다시 시도할게요.'
        : '오류가 발생했어요. 잠시 후 다시 시도해주세요.',
      provider: validProvider,
      availableProviders: ALL_PROVIDERS,
    }, { status: 200 }) // 500 대신 200으로 UI가 메시지 표시하게
  }
}
