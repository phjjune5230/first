import { NextRequest, NextResponse } from 'next/server'
import { callStockLLM } from '@/lib/llm'

const SYSTEM_PROMPT = `너는 주식 투자 비서야. 종목 분석, 뉴스 요약, 포트폴리오 관련 질문에 답해줘.
규칙: 투자 권유는 하지 마. 정보 제공만 해. 모르는 최신 정보는 모른다고 솔직하게 말해. 한국어로 대화해.`

export async function POST(req: NextRequest) {
  const { messages, action } = await req.json()

  if (action === 'save_session') {
    const result = await callStockLLM(
      [{ role: 'user', content: `다음 대화를 분석해서 JSON만 반환해.
{ "summary": "오늘 대화 내용 한 줄 요약", "notes": "특이사항", "weak_points": [] }
대화: ${messages.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join('\n')}` }],
      ''
    )
    try {
      const parsed = JSON.parse(result.content.replace(/```json|```/g, '').trim())
      const log = { date: new Date().toISOString().split('T')[0], ...parsed }
      return NextResponse.json({ ok: true, log })
    } catch {
      return NextResponse.json({ ok: false, error: '요약 파싱 실패' })
    }
  }

  const result = await callStockLLM(messages, SYSTEM_PROMPT)
  const content = `[${result.provider}] ${result.content}`
  return NextResponse.json({ content })
}
