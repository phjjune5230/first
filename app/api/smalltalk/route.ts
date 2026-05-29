import { NextRequest, NextResponse } from 'next/server'
import { appendDailyLog, getState, updateState } from '@/lib/supabase'
import { callAssistantLLM } from '@/lib/llm'

export async function POST(req: NextRequest) {
  const { messages, action } = await req.json()

  // 세션 저장 요청: 간단 요약 JSON을 생성해 저장
  if (action === 'save_session') {
    const result = await callAssistantLLM([
      { role: 'system', content: '다음 대화를 요약해서 JSON만 반환해. 필드는 summary, notes, weak_points(배열).' },
      { role: 'user', content: `대화:
${messages.map((m: any) => `${m.role}: ${m.content}`).join('\n')}` },
    ], '친근한 톤으로 요약하되 JSON만 반환해')

    try {
      const parsed = JSON.parse(result.content.replace(/```json|```/g, '').trim())
      const log = {
        date: new Date().toISOString().split('T')[0],
        summary: parsed.summary || '',
        notes: parsed.notes || '',
        weak_points: parsed.weak_points || [],
      }
      await appendDailyLog(log)
      const state = await getState()
      if (state) await updateState({ current_day: (state.current_day || 0) + 1 })
      return NextResponse.json({ ok: true, log })
    } catch (e) {
      return NextResponse.json({ ok: false, error: '요약 파싱 실패' })
    }
  }

  // 일반 잡담 채팅
  const systemPrompt = `너는 가볍게 수다 떠는 잡담 비서야. 친근하고 짧은 응답을 선호해. 한국어로 대화해.`

  const result = await callAssistantLLM(messages, systemPrompt)
  // 다른 API들과 동일하게 응답 앞에 공급자 표시를 붙여 반환한다.
  const content = `[${result.provider}] ${result.content}`
  return NextResponse.json({ content, provider: result.provider })
}
