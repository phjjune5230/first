import { NextRequest, NextResponse } from 'next/server'
import { getState, appendDailyLog, updateState, DailyLog } from '@/lib/supabase'
import { callEnglishLLM } from '@/lib/llm'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { messages, action } = body
  const state = await getState()

  if (action === 'save_session') {
    const result = await callEnglishLLM(
      [{ role: 'user', content: `다음 대화를 분석해서 JSON만 반환해. 다른 텍스트 없이 JSON만.
{
  "summary": "오늘 공부한 내용 한 줄 요약",
  "notes": "특이사항, 헷갈렸던 것",
  "weak_points": ["약점1", "약점2"]
}
대화:
${messages.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join('\n')}` }],
      ''
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

  const systemPrompt = buildSystemPrompt(state)
  const result = await callEnglishLLM(messages, systemPrompt)
  const content = `[${result.provider}] ${result.content}`

  if (result.content.includes('[CURRICULUM_READY]')) {
    const jsonMatch = result.content.match(/\[CURRICULUM_READY\]\s*({[\s\S]*})/)
    if (jsonMatch) {
      try {
        const curriculum = JSON.parse(jsonMatch[1])
        await updateState({ curriculum })
      } catch { console.error('curriculum parse error') }
    }
  }

  return NextResponse.json({ content })
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
오늘 학습 시작할 때 지난 내용 리뷰하고 오늘 할 것 안내해줘. 문법/표현 교정 자연스럽게 해줘.`
}
