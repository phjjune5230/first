import { NextRequest, NextResponse } from 'next/server'
import { getGoals, addGoal, updateGoal } from '@/lib/assistant'
import { callAssistantLLMWithTools } from '@/lib/llm'

const SYSTEM_PROMPT = `너는 사용자의 목표 관리를 돕는 비서야. 한국어로 응답해.

목표 추가/수정 요청이 오면 반드시 적절한 툴을 호출해.
- 정보가 충분하면 바로 툴 호출
- 대분류나 소분류가 없으면 먼저 질문해서 정보를 모은 후 툴 호출
- 수정 요청 시 목표 목록을 참고해서 id를 파악하고 update_goal 호출
- 툴 호출 후엔 "✅ 저장했어요!" 같이 짧게 확인 응답해`

export async function POST(req: NextRequest) {
  const { messages, provider, goals: clientGoals } = await req.json()

  // 목표 목록을 컨텍스트로 주입 (수정 시 id 파악용)
  const goals = clientGoals ?? await getGoals()
  const goalsContext = goals.length > 0
    ? `\n\n[현재 목표 목록]:\n${JSON.stringify(goals.map((g: any) => ({ id: g.id, category: g.category, subcategory: g.subcategory, status: g.status, due_date: g.due_date })))}`
    : ''

  try {
    const result = await callAssistantLLMWithTools(
      messages,
      SYSTEM_PROMPT + goalsContext,
      provider
    )

    // 툴 호출이 있으면 실행
    if (result.toolCalls && result.toolCalls.length > 0) {
      for (const tc of result.toolCalls) {
        if (tc.name === 'add_goal') {
          await addGoal({
            category:    tc.arguments.category,
            subcategory: tc.arguments.subcategory,
            description: tc.arguments.description ?? '',
            due_date:    tc.arguments.due_date ?? null,
            status:      tc.arguments.status ?? '진행중',
          })
        }
        if (tc.name === 'update_goal') {
          await updateGoal(tc.arguments.id, tc.arguments.updates)
        }
      }

      const toolNames = result.toolCalls.map(tc => tc.name).join(', ')
      const content = result.content || '✅ 완료했어요!'
      return NextResponse.json({ ok: true, content: `[${result.provider}] ${content}`, toolCalled: toolNames })
    }

    // 툴 호출 없음 = 추가 정보 요청 or 일반 응답
    return NextResponse.json({ ok: false, content: `[${result.provider}] ${result.content}` })

  } catch (err) {
    console.error('assistant function calling error:', err)
    return NextResponse.json({ ok: false, content: '오류가 발생했어요. 다시 시도해주세요.' }, { status: 500 })
  }
}
