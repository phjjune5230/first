import { NextRequest, NextResponse } from 'next/server'
import { getState, appendDailyLog, updateState, DailyLog, supabase } from '@/lib/supabase'
import { callEnglishLLMWithProvider } from '@/lib/llm'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { messages, action, provider } = body
  const state = await getState()

  if (action === 'save_session') {
    const result = await callEnglishLLMWithProvider(
      [{ role: 'user', content: `다음 대화를 분석해서 JSON만 반환해. 다른 텍스트 없이 JSON만.
{
  "summary": "오늘 공부한 내용 한 줄 요약",
  "notes": "특이사항, 헷갈렸던 것",
  "weak_points": ["약점1", "약점2"]
}
대화:
${messages.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join('\n')}` }],
      '',
      provider
    )
    const cleaned = result.content.replace(/```json|```/g, '').trim()
    try {
      const parsed = JSON.parse(cleaned)
      const log: DailyLog = { date: new Date().toISOString().split('T')[0], ...parsed }
      await appendDailyLog(log)
      if (state) await updateState({ current_day: state.current_day + 1 })
      return NextResponse.json({ ok: true, log })
    } catch {
      return NextResponse.json({ ok: false, error: '요약 파싱 실패' })
    }
  }

  if (action === 'undo_day') {
    if (state && state.current_day > 1) {
      await updateState({ current_day: state.current_day - 1 })
      return NextResponse.json({ ok: true, message: `${state.current_day - 1}일차로 되돌렸어요.` })
    }
    return NextResponse.json({ ok: false, error: '첫 날이라 되돌릴 수 없어요.' })
  }

  const systemPrompt = buildSystemPrompt(state)
  const result = await callEnglishLLMWithProvider(messages, systemPrompt, provider)
  const { data } = await supabase.from('llm_state').select('error_counts').eq('id', 1).single()
  const disabledProviders = Object.entries(data?.error_counts || {})
    .filter(([, count]) => typeof count === 'number' && count >= 3)
    .map(([p]) => p)

  const parsedResult = parseExampleResponse(result.content)
  const content = parsedResult.text ? `[${result.provider}] ${parsedResult.text}` : `[${result.provider}] ${result.content}`

  if (result.content.includes('[CURRICULUM_READY]')) {
    const jsonMatch = result.content.match(/\[CURRICULUM_READY\]\s*({[\s\S]*})/)
    if (jsonMatch) {
      try {
        const curriculum = JSON.parse(jsonMatch[1])
        await updateState({ curriculum })
      } catch { console.error('curriculum parse error') }
    }
  }

  return NextResponse.json({ content, provider: result.provider, disabledProviders, examples: parsedResult.examples })
}

function parseExampleResponse(raw: string) {
  const cleaned = raw.replace(/```json|```/g, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).examples)) {
      const examples = (parsed as any).examples
        .filter((item: any) => item && typeof item === 'object')
        .map((item: any) => ({
          speaker: String(item.speaker || item.role || 'Example'),
          sentence: String(item.sentence ?? item.text ?? ''),
        }))
        .filter((item: any) => item.sentence)
      return {
        text: typeof parsed.text === 'string' ? parsed.text.trim() : '',
        examples,
      }
    }
  } catch {
    // fallback
  }
  return { text: '', examples: [] }
}

function buildSystemPrompt(state: Awaited<ReturnType<typeof getState>>) {
  if (!state?.curriculum) {
    return `너는 영어 공부 비서야. 지금은 처음 만나는 단계야.
사용자와 대화해서 영어 학습 커리큘럼을 함께 만들어줘.
다음 순서로 진행해:
1. 영어 공부 목적 파악 (회화, 비즈니스, 시험 등)
2. 현재 수준 파악
3. 하루 공부 가능한 시간
4. 기간 설정
모든 정보가 모이면 주차별 커리큘럼을 만들고, 확정되면 이렇게 말해:
"[CURRICULUM_READY] { ... JSON 형식 커리큘럼 ... }"
커리큘럼 JSON 형식:
{ "goal": "목표", "level": "초급/중급/고급", "duration": "N주", "weekly_plan": ["1주차: ...", "2주차: ..."] }
한국어로 대화해. 친근하고 동기부여 되게.`
  }

  const recentLogs = state?.daily_logs?.slice(-3) || []
  const weakPoints = state?.weak_points || []

  return `너는 영어 공부 비서야.
[커리큘럼] 목표: ${state.curriculum.goal} / 수준: ${state.curriculum.level} / 기간: ${state.curriculum.duration}
현재: ${state.current_week}주차 ${state.current_day}일
[이번 주 계획] ${state.curriculum.weekly_plan?.[state.current_week - 1] || '계획 없음'}
[최근 학습] ${recentLogs.length > 0 ? recentLogs.map(l => `${l.date}: ${l.summary}`).join(' / ') : '없음'}
[약점] ${weakPoints.length > 0 ? weakPoints.join(', ') : '없음'}
오늘 학습 시작할 때 지난 내용 리뷰하고 오늘 할 것 안내해줘. 문법/표현 교정 자연스럽게 해줘.

응답은 반드시 다음 JSON 형식으로만 반환해. 다른 설명이나 추가 텍스트는 포함하지 마.
{
  "text": "상세 설명 텍스트",
  "examples": [
    { "speaker": "Teacher", "sentence": "Hello, how are you?" },
    { "speaker": "Student", "sentence": "I'm fine, thank you." }
  ]
}`
}
