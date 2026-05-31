import { NextRequest, NextResponse } from 'next/server'
import { getState, appendDailyStudy, updateState, StudyState } from '@/lib/supabase'
import { handleEnglishChat } from '@/lib/chatHandler'
import { getDefaultOptions } from '@/lib/defaultOptions'
import { validateProvider } from '@/lib/validation'
import { callEnglishLLMWithProvider, ALL_PROVIDERS } from '@/lib/llm'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { messages, action, provider } = body
  const state = await getState()

  // 세션 저장
  if (action === 'save_session') {
    try {
      const validProvider = validateProvider(provider)
      const result = await callEnglishLLMWithProvider(
        [{ role: 'user', content: `다음 대화를 분석해서 JSON만 반환해. 다른 텍스트 없이 JSON만.
{
  "summary": "오늘 공부한 내용 한 줄 요약",
  "notes": "특이사항, 헷갈렸던 것",
  "weak_points": ["구체적인 약점1", "구체적인 약점2"],
  "learned_expressions": ["오늘 배운 표현1", "오늘 배운 표현2"],
  "plan_update": "오늘 학습 결과를 반영한 앞으로의 학습 계획. 기존 계획에서 수정/보완할 내용 상세하게 작성."
}
대화:
${messages.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join('\n')}` }],
        '',
        validProvider
      )
      const cleaned = result.content.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(cleaned)

      // daily_study 저장
      await appendDailyStudy({
        date: new Date().toISOString().split('T')[0],
        summary: parsed.summary || '',
        notes: parsed.notes || '',
        weak_points: parsed.weak_points || [],
        learned_expressions: parsed.learned_expressions || [],
      })

      // plan 업데이트
      if (parsed.plan_update) {
        await updateState({ plan: parsed.plan_update })
      }

      await updateState({ current_day: (state?.current_day || 0) + 1 })

      return NextResponse.json({ ok: true, log: parsed })
    } catch (err) {
      console.error('Save session error:', err)
      return NextResponse.json({ ok: false, error: '요약 파싱 실패' })
    }
  }

  // undo_day
  if (action === 'undo_day') {
    if (state && state.current_day > 1) {
      await updateState({ current_day: state.current_day - 1 })
      return NextResponse.json({ ok: true, message: `${state.current_day - 1}일차로 되돌렸어요.` })
    }
    return NextResponse.json({ ok: false, error: '첫 날이라 되돌릴 수 없어요.' })
  }

  // 일반 채팅
  try {
    const validProvider = validateProvider(provider)
    const systemPrompt = buildSystemPrompt(state)
    const result = await handleEnglishChat(messages, systemPrompt, validProvider, getDefaultOptions('english'))

    // goal/plan 설정 처리
    if (result.content.includes('[SETUP_READY]')) {
      const jsonMatch = result.content.match(/\[SETUP_READY\]\s*({[\s\S]*?})\s*(?:\[|$)/)
      if (jsonMatch) {
        try {
          const setup = JSON.parse(jsonMatch[1])
          await updateState({ goal: setup.goal, plan: setup.plan })
        } catch { console.error('setup parse error') }
      }
    }

    return NextResponse.json({
      content: result.content,
      provider: result.provider,
      availableProviders: ALL_PROVIDERS,
      disabledProviders: result.disabledProviders,
      examples: result.examples,
    })
  } catch (err) {
    console.error('LLM call error:', err)
    return NextResponse.json({ ok: false, error: String(err), availableProviders: ALL_PROVIDERS }, { status: 500 })
  }
}

function buildSystemPrompt(state: StudyState | null) {
  // 처음 설정 단계
  if (!state?.goal) {
    return `너는 영어 공부 비서야. 처음 만나는 단계야.
사용자와 대화해서 학습 목표와 계획을 함께 만들어줘.

다음 순서로 진행해:
1. 영어 공부 최종 목표 파악 (예: 원어민과 자유 회화, 비즈니스 영어 등)
2. 현재 수준 파악
3. 하루 공부 가능한 시간
4. 기간 설정
5. 목표/수준/시간/기간 기반으로 상세한 학습 계획 작성

모든 정보가 모이면 확정 전에 사용자에게 확인 받고, 확정되면 이렇게 말해:
"[SETUP_READY] { "goal": "최종 목표", "plan": "상세한 학습 계획. 단계별 진행 방법, 매일 학습 방식, 예상 커리큘럼 등 최대한 상세하게." }"

한국어로 대화해. 친근하고 동기부여 되게.`
  }

  // 학습 중 설정 변경 요청 처리 안내 포함
  const recentStudies = state.daily_studies?.slice(-3) || []
  const weakPoints = state.weak_points || []
  const learnedExpressions = state.learned_expressions || []
  const lastStudy = recentStudies[recentStudies.length - 1]

  return `너는 영어 공부 선생님이야. 아래 정보를 바탕으로 오늘 학습을 진행해.

[최종 목표]
${state.goal}

[학습 계획]
${state.plan || '계획 없음'}

[현재 진행]
${state.current_week}주차 ${state.current_day}일

[지난 세션 요약]
${lastStudy ? `${lastStudy.date}: ${lastStudy.summary}\n노트: ${lastStudy.notes}` : '없음'}

[누적 약점]
${weakPoints.length > 0 ? weakPoints.join(', ') : '없음'}

[지금까지 학습한 표현]
${learnedExpressions.length > 0 ? learnedExpressions.slice(-20).join(', ') : '없음'}

---

[행동 지침]
1. 세션 시작 시: 지난 세션 핵심 내용 간략 복습 → 오늘 학습 주제와 방법 안내
2. 학습 진행: 예문 제시 → 사용자 응답 확인 → 피드백 → 다음 스텝
3. 학습 완료 판단: 네가 판단하되, 사용자가 추가 요청하면 이어서 진행
4. 질문 처리: 사용자가 질문하면 흐름 멈추고 답변 → 다시 학습 흐름으로 복귀
5. 설정 변경: 사용자가 목표/계획 수정 요청하면 대화로 수정 후 "[SETUP_READY] {...}" 형식으로 저장
6. 응답 형식: 설명이 있으면 text에, 예문이 있으면 examples에 담아서 JSON으로 반환

응답은 반드시 다음 JSON 형식으로만 반환해:
{
  "text": "설명, 피드백, 안내 텍스트",
  "examples": [
    { "speaker": "Teacher", "sentence": "예문" },
    { "speaker": "Student", "sentence": "예문" }
  ]
}
예문이 없으면 examples는 빈 배열로.`
}