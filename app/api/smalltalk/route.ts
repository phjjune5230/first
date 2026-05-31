import { NextRequest, NextResponse } from 'next/server'
import { appendDailyLog, getState, updateState } from '@/lib/supabase'
import { handleChat } from '@/lib/chatHandler'
import { getDefaultOptions } from '@/lib/defaultOptions'
import { validateProvider } from '@/lib/validation'
import { callAssistantLLM, ALL_PROVIDERS } from '@/lib/llm'

export async function POST(req: NextRequest) {
  const { messages, action, provider } = await req.json()
  const validProvider = validateProvider(provider)

  // save_session 액션 처리
  if (action === 'save_session') {
    try {
      const result = await callAssistantLLM(
        [
          { role: 'system', content: '다음 대화를 요약해서 JSON만 반환해. 필드는 summary, notes, weak_points(배열).' },
          {
            role: 'user',
            content: `대화:\n${messages.map((m: any) => `${m.role}: ${m.content}`).join('\n')}`,
          },
        ],
        '친근한 톤으로 요약하되 JSON만 반환해'
      )

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
      console.error('Save session error:', e)
      return NextResponse.json({ ok: false, error: '요약 파싱 실패' })
    }
  }

  // 일반 잡담 채팅
  try {
    const systemPrompt = `너는 가볍게 수다 떠는 잡담 비서야. 친근하고 짧은 응답을 선호해. 한국어로 대화해.`
    const options = getDefaultOptions('smalltalk')

    const result = await handleChat(messages, systemPrompt, validProvider, options)

    return NextResponse.json({
      content: result.content,
      provider: result.provider,
      availableProviders: ALL_PROVIDERS,
      disabledProviders: result.disabledProviders,
    })
  } catch (err) {
    console.error('LLM call error:', err)
    return NextResponse.json(
      {
        ok: false,
        error: String(err),
        availableProviders: ALL_PROVIDERS,
      },
      { status: 500 }
    )
  }
}