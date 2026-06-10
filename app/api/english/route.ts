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
        [{ role: 'user', content: `다음 대화를 분석해서 JSON만 반환해. 다른 텍스트 없이 JSON만.\n{\n  "summary": "오늘 공부한 내용 한 줄 요약",\n  "notes": "특이사항, 헷갈렸던 것",\n  "weak_points": ["구체적인 약점1", "구체적인 약점2"],\n  "learned_expressions": ["오늘 배운 표현1", "오늘 배운 표현2"],\n  "plan_update": "오늘 학습 결과를 반영한 앞으로의 학습 계획. 기존 계획에서 수정/보완할 내용 상세하게 작성."\n}\n대화:\n${messages.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join('\n')}` }],
        '',
        validProvider
      )

      // [Fix 1] JSON 파싱 실패 시 빈 응답 대신 fallback 값으로 저장
      let parsed: Record<string, any> = {}
      try {
        const cleaned = result.content.replace(/```json|```/g, '').trim()
        parsed = JSON.parse(cleaned)
      } catch {
        console.error('Session JSON parse failed, using fallback:', result.content)
        parsed = { summary: '세션 요약 파싱 실패', notes: '', weak_points: [], learned_expressions: [], plan_update: null }
      }

      // [Fix 3] weak_points / learned_expressions 누적 — appendDailyStudy에 올바르게 전달
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

      // [Fix 2] current_day 증가 + 7일 완료 시 week 전환
      const currentDay = state?.current_day || 0
      const currentWeek = state?.current_week || 1
      const nextDay = currentDay + 1
      if (nextDay > 7) {
        await updateState({ current_day: 1, current_week: currentWeek + 1 })
      } else {
        await updateState({ current_day: nextDay })
      }

      return NextResponse.json({ ok: true, log: parsed })
    } catch (err) {
      console.error('Save session error:', err)
      return NextResponse.json({ ok: false, error: '세션 저장 실패' })
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

    // [Fix 5] goal/plan 설정 처리 — 중첩 중괄호에 안전한 파싱
    if (result.content.includes('[SETUP_READY]')) {
      const setupIdx = result.content.indexOf('[SETUP_READY]')
      const jsonStart = result.content.indexOf('{', setupIdx)
      if (jsonStart !== -1) {
        // 중괄호 depth 카운팅으로 올바른 JSON 범위 추출
        let depth = 0
        let jsonEnd = -1
        for (let i = jsonStart; i < result.content.length; i++) {
          if (result.content[i] === '{') depth++
          else if (result.content[i] === '}') {
            depth--
            if (depth === 0) { jsonEnd = i; break }
          }
        }
        if (jsonEnd !== -1) {
          try {
            const setup = JSON.parse(result.content.slice(jsonStart, jsonEnd + 1))
            await updateState({ goal: setup.goal, plan: setup.plan })
          } catch { console.error('setup parse error') }
        }
      }
    }

    return NextResponse.json({
      content: result.content,
      provider: result.provider,
      availableProviders: ALL_PROVIDERS,
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

  return `너는 원어민 영어 회화 선생님이야. 아래 정보를 바탕으로 오늘 수업을 진행해.
모든 예문과 표현은 실제 원어민이 일상에서 쓰는 자연스러운 표현 중심으로 구성해.

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

[세션 구조 - 반드시 이 순서로 진행]

▶ 세션 시작
- 지난 세션 핵심 표현 1~2개 간단 복습
- 오늘 수업 플랜 브리핑:
  "오늘 주제는 [주제]입니다.
   1단계: [주제] 관련 실생활 예문 5개씩 3턴 학습
   2단계: [상황] 상황극 4가지 (제가 두 역할 모두 합니다)
   3단계: 아웃풋 연습 3회 (상황 드리면 직접 영어로 말해보기)
   4단계: 추가 학습 여부 확인
   마무리: 오늘 배운 표현 정리"

▶ 1단계 - 예문 인풋 (총 3턴)
- 매 턴마다 새로운 실생활 표현 예문 5개 제시
- 각 예문에 한국어 설명 포함
- 5개 제시 후: "발음 들어보시고, 준비되면 다음 턴으로 넘어갈까요?"
- 3턴 완료 후 2단계로

▶ 2단계 - 상황극 인풋 (총 4상황)
- 너가 A, B 두 역할 모두 담당
- 실생활 상황 설정 후 자연스러운 대화 전체 제시
- 각 상황 후: "다음 상황으로 넘어갈까요?"
- 4상황 완료 후 3단계로

▶ 3단계 - 아웃풋 (총 3회)
- 상황 제시 또는 대화 중간에서 끊고 사용자가 이어받기
- 사용자 답변 후: 교정 + "원어민이라면 이렇게 말했을 것: [표현]" 항상 포함
- 3회 완료 후 4단계로

▶ 4단계 - 추가 학습
- "예문/상황극/아웃풋 중 더 하고 싶은 부분 있으신가요?"
- 있으면 해당 유형 추가 진행
- 없으면 마무리로

▶ 마무리
- 사용자가 "마무리" 또는 "끝내자" 등 종료 신호 시 전환
- 오늘 배운 핵심 표현 전체 정리
- "세션 종료 & 저장 버튼을 눌러 오늘 학습을 저장해주세요"

---

[추가 지침]
- 사용자 질문 시: 흐름 멈추고 답변 → 다시 현재 단계로 복귀
- 설정 변경 요청 시: 대화로 수정 후 "[SETUP_READY] {...}" 형식으로 저장
- 단계 전환은 항상 사용자 확인 후 진행

응답은 반드시 다음 JSON 형식으로만 반환해:
{
  "text": "설명, 안내, 피드백 텍스트",
  "examples": [
    { "speaker": "John", "sentence": "예문", "translation": "한국어 설명", "type": "example" },
    { "speaker": "Sarah", "sentence": "예문", "translation": "한국어 설명", "type": "example" }
  ]
}
예문/상황극은 examples에, 설명/안내/피드백은 text에 담아.
예문이 없으면 examples는 빈 배열로.

translation 규칙:
- 형식: "[직역/의미] + [뉘앙스/상황 설명]" 두 가지를 함께 작성
- 예시: "나 요즘 좀 지쳐있어. → 감정을 담담하게 털어놓을 때 쓰는 캐주얼한 표현"
- 예시: "그냥 확인하려고요. → 부탁/요청 앞에 부드럽게 붙이는 전형적인 비즈니스 표현"
- output_prompt 타입은 translation 생략 가능

type 규칙:
- 1단계(예문 인풋), 2단계(상황극 인풋): "type": "example"
- 3단계(아웃풋 연습) 사용자가 직접 말해야 하는 문장/상황: "type": "output_prompt"

speaker 규칙:
- 화자는 실제 인물명으로 (John, Sarah, Mike, Emma 등 상황에 맞게)
- 같은 대화 내 speaker 이름은 일관되게 유지
- 2인: 남자/여자, 3인: 남/여/남, 4인: 남/여/남/여 순서로`
}