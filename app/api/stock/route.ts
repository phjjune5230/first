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
  if (normalized.includes('STOCK_PRICES') && !normalized.includes('DATE')) {
    throw new Error('날짜 조건이 없는 쿼리는 실행할 수 없습니다.')
  }
}

// ── 오늘 날짜 YYYYMMDD ──────────────────────────────
function todayYYYYMMDD(): string {
  return new Date().toISOString().split('T')[0].replace(/-/g, '')
}

// ── 기간 → startDate/endDate 변환 ───────────────────
function resolvePeriod(period: { type: string; value: string }): { startDate: string; endDate: string } | null {
  const { type, value } = period

  if (type === 'month') {
    // value: "2026-03"
    const [year, month] = value.split('-')
    const start = `${year}${month}01`
    const lastDay = new Date(Number(year), Number(month), 0).getDate()
    const end = `${year}${month}${String(lastDay).padStart(2, '0')}`
    return { startDate: start, endDate: end }
  }

  if (type === 'range') {
    // value: "2026-03-01~2026-03-31"
    const [s, e] = value.split('~')
    return {
      startDate: s.replace(/-/g, ''),
      endDate: e.replace(/-/g, ''),
    }
  }

  if (type === 'days') {
    // value: "7" (최근 N일)
    const days = parseInt(value)
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - days)
    return {
      startDate: start.toISOString().split('T')[0].replace(/-/g, ''),
      endDate: end.toISOString().split('T')[0].replace(/-/g, ''),
    }
  }

  if (type === 'year') {
    // value: "2026"
    return { startDate: `${value}0101`, endDate: `${value}1231` }
  }

  return null
}

// ── 서버가 SQL 직접 조립 (단순 케이스) ─────────────
function buildSimpleSQL(
  verifiedTickers: { ticker: string; market: string; name: string }[],
  fields: string[],
  startDate: string,
  endDate: string
): string {
  const allowedFields = ['open', 'high', 'low', 'close', 'volume']
  const safeFields = fields.filter(f => allowedFields.includes(f))
  if (safeFields.length === 0) safeFields.push('close')

  const selectFields = safeFields.map(f => `sp.${f}`).join(', ')
  const tickerConditions = verifiedTickers
    .map(t => `(sp.ticker = '${t.ticker}' AND sp.market = '${t.market}')`)
    .join(' OR ')

  return `
    SELECT sp.ticker, sp.market, sp.date, ${selectFields}
    FROM stock_prices sp
    WHERE (${tickerConditions})
    AND sp.date >= '${startDate}' AND sp.date <= '${endDate}'
    ORDER BY sp.date ASC, sp.ticker ASC
    LIMIT 100
  `.trim()
}

// ── 1단계 LLM 프롬프트: 단순/복잡 판단 + 정보 추출 ─
const PARSE_SYSTEM_PROMPT = `너는 주식 질문 분석기야. 사용자 질문을 분석해서 JSON만 반환해. 다른 텍스트 없이 JSON만.

## 단순 질문 (type: "simple")
- 특정 종목(들) + 기간 + 필드 조합
- 예: "삼성전기 3월 주가", "삼성전자랑 SK하이닉스 5월 종가 비교", "애플 최근 1주일 거래량"

## 복잡 질문 (type: "complex")  
- 랭킹/집계: "코스피에서 가장 많이 오른 종목 TOP 5"
- 조건 필터: "거래량 100만 이상인 날만"
- 계산: "수익률", "이동평균"
- 종목명 없이 시장 전체 대상

## 기간 미입력 (type: "ask")
- 종목은 있지만 기간이 전혀 없는 경우

## 반환 형식

### 단순:
{
  "type": "simple",
  "stocks": [
    { "name": "삼성전기", "ticker": "009150", "market": "KOSPI" },
    { "name": "애플",     "ticker": "AAPL",   "market": "NASDAQ" }
  ],
  "period": { "type": "month", "value": "2026-03" },
  "fields": ["close"]
}

stocks 규칙:
- ticker: 한국 종목은 6자리 숫자 (예: "005930"), 미국 종목은 심볼 (예: "AAPL", "RDW")
- market: "KOSPI" | "KOSDAQ" | "NASDAQ" | "NYSE"
- ticker를 모르면 빈 문자열 "" 로 두기 (서버가 name으로 LIKE 검색함)

period.type 종류:
- "month": { "type": "month", "value": "YYYY-MM" }
- "range": { "type": "range", "value": "YYYY-MM-DD~YYYY-MM-DD" }
- "days":  { "type": "days",  "value": "7" }  (최근 N일)
- "year":  { "type": "year",  "value": "YYYY" }

fields 가능 값: "open", "high", "low", "close", "volume"
fields 미입력 → ["close"]

### 복잡:
{
  "type": "complex",
  "sql": "SELECT ... (완성된 SQL)"
}

SQL 규칙:
- 테이블: stock_prices(ticker,market,date,open,high,low,close,volume), stocks(ticker,name,market)
- date 형식: YYYYMMDD 문자열
- 오늘: ${todayYYYYMMDD()}
- SELECT만, LIMIT 최대 100
- market 컬럼 반드시 포함
- strftime 등 날짜 함수 금지, 문자열 직접 비교

### 기간 없음:
{
  "type": "ask"
}

### 주식 무관 질문:
{
  "type": "general"
}`

// ── 3단계: 자연어 답변 프롬프트 ────────────────────
function buildAnswerPrompt(question: string, sql: string, rows: any[], display: string): string {
  const displayHint = display === 'table+chart' || display === 'table'
    ? '\n- 데이터는 테이블/차트로 별도 표시되므로 숫자를 일일이 나열하지 말고 전체 흐름/특징 위주로 요약해줘'
    : ''

  const markets = [...new Set(rows.map((r: any) => r.market).filter(Boolean))]
  const currencyHint = markets.length > 0
    ? `\n- 통화: KOSPI/KOSDAQ → 원(₩), NASDAQ/NYSE → 달러($) (이 쿼리의 market: ${markets.join(', ')})`
    : '\n- 통화: KOSPI/KOSDAQ → 원(₩), NASDAQ/NYSE → 달러($)'

  return `너는 주식 비서야. 아래 데이터를 바탕으로 사용자 질문에 친절하게 답해줘.

규칙:
- 투자 권유 절대 금지, 정보 제공만
- 숫자는 읽기 쉽게 포맷 (원화: 78,500원 / 달러: $178.50)
- 데이터가 없으면 솔직하게 말해
- 한국어로 답해${currencyHint}${displayHint}

사용자 질문: ${question}
실행된 SQL: ${sql}
조회 결과 (${rows.length}행):
${JSON.stringify(rows.slice(0, 20), null, 2)}${rows.length > 20 ? `\n...(총 ${rows.length}행)` : ''}`
}

// ── display 타입 결정 ────────────────────────────────
function resolveDisplay(rows: any[], period: { type: string; value: string } | null): 'chat' | 'table' | 'table+chart' {
  if (rows.length <= 1) return 'chat'
  // 날짜 컬럼이 있고 기간이 일주일 이상이면 차트
  const hasDate = rows[0] && 'date' in rows[0]
  if (hasDate && period) {
    if (period.type === 'month' || period.type === 'year') return 'table+chart'
    if (period.type === 'days' && parseInt(period.value) >= 7) return 'table+chart'
    if (period.type === 'range') return 'table+chart'
  }
  return 'table'
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

  // ── 일반 채팅 ────────────────────────────────────
  try {
    const userQuestion = messages[messages.length - 1]?.content ?? ''

    // ── 1단계: 질문 파싱 (단순/복잡/ask/general 판단) ─
    const recentMessages = messages.slice(-6).map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))
    const parseResult = await callStockSQLLLM(recentMessages, PARSE_SYSTEM_PROMPT)

    type StockInput = { name: string; ticker: string; market: string }
    let parsed: {
      type: 'simple' | 'complex' | 'ask' | 'general'
      stocks?: StockInput[]
      period?: { type: string; value: string }
      fields?: string[]
      sql?: string
    }

    try {
      parsed = JSON.parse(parseResult.content.replace(/```json|```/g, '').trim())
    } catch {
      parsed = { type: 'general' }
    }

    // ── ask: 기간 미입력 ─────────────────────────────
    if (parsed.type === 'ask') {
      return NextResponse.json({
        content: '조회할 기간을 말씀해주세요. (예: 3월, 최근 1주일, 2026년 1분기)',
        display: 'ask',
        provider: validProvider,
        availableProviders: ALL_PROVIDERS,
        dataSource: 'ask',
      })
    }

    // ── general: 주식 무관 질문 ──────────────────────
    if (parsed.type === 'general') {
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

    // ── complex: LLM이 SQL 직접 생성 ────────────────
    if (parsed.type === 'complex' && parsed.sql) {
      validateSQL(parsed.sql)
      console.log('[SQL][complex]', parsed.sql)

      const client = getTursoClient()
      let rows: any[] = []
      try {
        const rs = await client.execute(parsed.sql)
        rows = rs.rows.map((row: any) => {
          const obj: Record<string, any> = {}
          rs.columns.forEach((col: string, i: number) => { obj[col] = row[i] })
          return obj
        })
      } finally {
        client.close()
      }

      const display = resolveDisplay(rows, null)
      const answerPrompt = buildAnswerPrompt(userQuestion, parsed.sql, rows, display)
      const result = await callStockLLM(
        [{ role: 'user', content: answerPrompt }],
        '',
        validProvider
      )

      return NextResponse.json({
        content: result.content,
        display,
        rows,
        provider: result.provider,
        availableProviders: ALL_PROVIDERS,
        dataSource: 'turso',
        rowCount: rows.length,
      })
    }

    // ── simple: 서버가 종목 검증 + SQL 직접 조립 ─────
    if (parsed.type === 'simple' && parsed.stocks && parsed.period) {
      const client = getTursoClient()

      // 2단계: 종목명 DB 검증
      const verifiedTickers: { ticker: string; market: string; name: string }[] = []
      const notFoundStocks: string[] = []
      const confirmCandidates: { query: string; candidates: string[] }[] = []

      try {
        for (const stock of parsed.stocks) {
          // 1순위: ticker + market 정확 매칭
          if (stock.ticker && stock.market) {
            const tickerRs = await client.execute({
              sql: `SELECT ticker, market, name FROM stocks WHERE ticker = ? AND market = ? LIMIT 1`,
              args: [stock.ticker, stock.market],
            })
            if (tickerRs.rows.length > 0) {
              const row = tickerRs.rows[0] as any
              verifiedTickers.push({ ticker: row[0], market: row[1], name: row[2] })
              continue
            }
          }

          // 2순위: name 정확 매칭
          if (stock.name) {
            const nameRs = await client.execute({
              sql: `SELECT ticker, market, name FROM stocks WHERE name = ? LIMIT 1`,
              args: [stock.name],
            })
            if (nameRs.rows.length > 0) {
              const row = nameRs.rows[0] as any
              verifiedTickers.push({ ticker: row[0], market: row[1], name: row[2] })
              continue
            }
          }

          // 3순위: name LIKE 후보 탐색 → 컨펌 요청
          const keyword = (stock.name || stock.ticker).replace(/[()（）\s]/g, '').slice(0, 10)
          const likeRs = await client.execute({
            sql: `SELECT name, ticker, market FROM stocks WHERE name LIKE ? OR ticker LIKE ? LIMIT 5`,
            args: [`%${keyword}%`, `%${keyword}%`],
          })

          if (likeRs.rows.length > 0) {
            const candidates = likeRs.rows.map((r: any) => `${r[0]} (${r[1]}, ${r[2]})`)
            confirmCandidates.push({ query: stock.name || stock.ticker, candidates })
          } else {
            notFoundStocks.push(stock.name || stock.ticker)
          }
        }
      } finally {
        client.close()
      }

      // 후보가 있으면 컨펌 요청
      if (confirmCandidates.length > 0) {
        const confirmMsg = confirmCandidates.map(({ query, candidates }) =>
          `"${query}"와(과) 정확히 일치하는 종목이 없어요.\n\n비슷한 종목:\n${candidates.map(c => `• ${c}`).join('\n')}`
        ).join('\n\n')

        return NextResponse.json({
          content: confirmMsg + '\n\n정확한 종목명으로 다시 질문해 주세요.',
          display: 'chat',
          provider: validProvider,
          availableProviders: ALL_PROVIDERS,
          dataSource: 'llm',
        })
      }

      // 아예 없는 종목
      if (notFoundStocks.length > 0) {
        return NextResponse.json({
          content: `다음 종목을 찾을 수 없어요: ${notFoundStocks.join(', ')}\n\n정확한 종목명으로 다시 질문해 주세요.`,
          display: 'chat',
          provider: validProvider,
          availableProviders: ALL_PROVIDERS,
          dataSource: 'llm',
        })
      }

      // 기간 변환
      const resolvedPeriod = resolvePeriod(parsed.period)
      if (!resolvedPeriod) {
        return NextResponse.json({
          content: '기간을 이해하지 못했어요. (예: 3월, 최근 1주일, 2026년 1분기)',
          display: 'ask',
          provider: validProvider,
          availableProviders: ALL_PROVIDERS,
          dataSource: 'ask',
        })
      }

      // SQL 조립 & 실행
      const sql = buildSimpleSQL(verifiedTickers, parsed.fields ?? ['close'], resolvedPeriod.startDate, resolvedPeriod.endDate)
      console.log('[SQL][simple]', sql)

      const client2 = getTursoClient()
      let rows: any[] = []
      try {
        const rs = await client2.execute(sql)
        rows = rs.rows.map((row: any) => {
          const obj: Record<string, any> = {}
          rs.columns.forEach((col: string, i: number) => { obj[col] = row[i] })
          return obj
        })
      } finally {
        client2.close()
      }

      const display = resolveDisplay(rows, parsed.period)
      const answerPrompt = buildAnswerPrompt(userQuestion, sql, rows, display)
      const result = await callStockLLM(
        [{ role: 'user', content: answerPrompt }],
        '',
        validProvider
      )

      return NextResponse.json({
        content: result.content,
        display,
        rows,
        provider: result.provider,
        availableProviders: ALL_PROVIDERS,
        dataSource: 'turso',
        rowCount: rows.length,
      })
    }

    // 파싱 실패 fallback
    throw new Error('질문을 이해하지 못했습니다.')

  } catch (err) {
    console.error('Stock chat error:', err)
    const errMsg = String(err)
    const isSQL = errMsg.includes('SQL') || errMsg.includes('sqlite')
    return NextResponse.json({
      content: isSQL
        ? '죄송해요, 데이터 조회 중 문제가 생겼어요. 질문을 좀 더 구체적으로 해주시면 다시 시도할게요.'
        : '오류가 발생했어요. 잠시 후 다시 시도해주세요.',
      display: 'chat',
      provider: validProvider,
      availableProviders: ALL_PROVIDERS,
    }, { status: 200 })
  }
}