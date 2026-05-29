import { NextRequest, NextResponse } from 'next/server'
import { getGoals, addGoal, updateGoal } from '@/lib/assistant'
import { callAssistantLLM } from '@/lib/llm'

export async function POST(req: NextRequest) {
  const { messages, action } = await req.json()

  if (action === 'add_goal') {
    const userInput = messages[messages.length - 1].content
    const result = await callAssistantLLM(
      [{ role: 'user', content: userInput }],
      `사용자가 목표를 입력했어. 아래 두 가지 중 하나로 응답해.
1. 양식이 충분하면 (대분류, 소분류 최소 있으면):
   [SAVE_GOAL]{"category":"...","subcategory":"...","description":"...","due_date":"YYYY-MM-DD or null","status":"진행중"}
   그리고 "저장했어요!" 라고 말해.
2. 양식이 불충분하면: [SAVE_GOAL] 태그 없이 어떤 정보가 빠졌는지 친절하게 안내해.
한국어로 응답해.`
    )

    const text = result.content
    if (text.includes('[SAVE_GOAL]')) {
      const jsonMatch = text.match(/\[SAVE_GOAL\]({[\s\S]*?})/)
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1])
          await addGoal(parsed)
          const content = `[${result.provider}] ✅ 목표가 저장됐어요!\n\n다른 목표도 추가하려면 입력해주세요.`
          return NextResponse.json({ ok: true, content })
        } catch {
          const content = `[${result.provider}] 저장 중 오류가 발생했어요. 다시 시도해주세요.`
          return NextResponse.json({ ok: false, content })
        }
      }
    }
    const content = `[${result.provider}] ${text}`
    return NextResponse.json({ ok: false, content })
  }

  if (action === 'edit_goal') {
    const goals = await getGoals()
    const result = await callAssistantLLM(
      [{ role: 'user', content: messages[messages.length - 1].content }],
      `사용자가 목표 수정을 요청했어. 현재 목표 목록:
${JSON.stringify(goals.map(g => ({ id: g.id, category: g.category, subcategory: g.subcategory, due_date: g.due_date, status: g.status })))}
수정할 id와 변경 내용을 JSON만 반환해: { "id": 숫자, "updates": { "변경할필드": "값" } }`
    )
    try {
      const { id, updates } = JSON.parse(result.content.replace(/```json|```/g, '').trim())
      await updateGoal(id, updates)
      const content = `[${result.provider}] ✅ ${id}번 목표가 수정됐어요!`
      return NextResponse.json({ ok: true, content })
    } catch {
      const content = `[${result.provider}] 수정 실패. 다시 입력해주세요.`
      return NextResponse.json({ ok: false, content })
    }
  }

  return NextResponse.json({ content: '알 수 없는 요청이에요.' })
}
