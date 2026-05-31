import { NextRequest, NextResponse } from 'next/server'
import { handleChat } from '@/lib/chatHandler'
import { getDefaultOptions } from '@/lib/defaultOptions'
import { validateProvider } from '@/lib/validation'
import { ALL_PROVIDERS, callAssistantLLMWithProvider } from '@/lib/llm'
import {
  getSmalltalkConversations,
  getSmalltalkConversation,
  createSmalltalkConversation,
  updateSmalltalkConversation,
  deleteSmalltalkConversation,
} from '@/lib/supabase'

// 대화 목록 조회
export async function GET() {
  const conversations = await getSmalltalkConversations()
  return NextResponse.json({ conversations })
}

export async function DELETE(req: NextRequest) {
  const { conversationId } = await req.json()
  await deleteSmalltalkConversation(conversationId)
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { messages, provider, action, conversationId } = body
  const validProvider = validateProvider(provider)

  // ── 세션 종료 & 저장 ──────────────────────────────
  if (action === 'save_session' && conversationId) {
    try {
      const conv = await getSmalltalkConversation(conversationId)
      const prevSummary = conv?.summary || ''

      // 오래된 메시지(앞부분)를 LLM으로 요약
      const summaryPrompt = `다음은 잡담 대화야. 핵심 내용을 3~5문장으로 요약해줘. 이전 요약이 있으면 합쳐서 업데이트해.

이전 요약: ${prevSummary || '없음'}

새 대화:
${messages.map((m: { role: string; content: string }) => `${m.role === 'user' ? '나' : 'AI'}: ${m.content}`).join('\n')}

요약:`

      const summaryResult = await callAssistantLLMWithProvider(
        [{ role: 'user', content: summaryPrompt }],
        '너는 대화 요약 도우미야. 핵심만 간결하게 요약해.',
        validProvider
      )

      // 최근 20개 메시지만 저장
      const recentMessages = messages
        .filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant')
        .slice(-20)

      await updateSmalltalkConversation(conversationId, {
        summary: summaryResult.content,
        last_messages: recentMessages,
      })

      return NextResponse.json({ ok: true, summary: summaryResult.content })
    } catch (err) {
      console.error('save_session error:', err)
      return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
    }
  }

  // ── 새 대화 생성 ──────────────────────────────────
  if (action === 'create_conversation') {
    const firstMessage = messages?.[0]?.content || '새 대화'
    // 첫 메시지로 제목 자동 생성 (20자 제한)
    const title = firstMessage.length > 20 ? firstMessage.slice(0, 20) + '…' : firstMessage
    const conv = await createSmalltalkConversation(title)
    return NextResponse.json({ conversation: conv })
  }

  // ── 일반 대화 ─────────────────────────────────────
  try {
    // 이어하기: 해당 대화의 요약을 system prompt에 주입
    let contextSummary = ''
    if (conversationId) {
      const conv = await getSmalltalkConversation(conversationId)
      if (conv?.summary) {
        contextSummary = `\n\n[이전 대화 기억]: ${conv.summary}`
      }
    }

    const systemPrompt = `너는 가볍게 수다 떠는 잡담 비서야. 친근하고 짧은 응답을 선호해. 한국어로 대화해.${contextSummary}`

    const result = await handleChat(messages, systemPrompt, validProvider, getDefaultOptions('smalltalk'))

    const firstUserMessage = messages.find((m: { role: string }) => m.role === 'user')?.content

    return NextResponse.json({
      content: result.content,
      provider: result.provider,
      availableProviders: ALL_PROVIDERS,
      disabledProviders: result.disabledProviders,
      firstUserMessage: !body.conversationId ? firstUserMessage : undefined,
    })
  } catch (err) {
    console.error('LLM call error:', err)
    return NextResponse.json({ ok: false, error: String(err), availableProviders: ALL_PROVIDERS }, { status: 500 })
  }
}
