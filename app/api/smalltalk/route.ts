import { NextRequest, NextResponse } from 'next/server'
import { handleChat } from '@/lib/chatHandler'
import { getDefaultOptions } from '@/lib/defaultOptions'
import { validateProvider } from '@/lib/validation'
import { ALL_PROVIDERS, callAssistantLLMWithProvider, callSmallTalkLLM } from '@/lib/llm'
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
      const summarizedUpTo = (conv?.last_messages as any)?.summarizedUpTo ?? 0

      const chatMessages = messages.filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant')
      const unsummarized = chatMessages.slice(summarizedUpTo)

      if (unsummarized.length === 0) return NextResponse.json({ ok: true })

      const summaryPrompt = `다음은 잡담 대화야. 이름, 나이, 직업 등 사실 정보와 주요 토픽을 포함해서 3~7문장으로 요약해줘. 이전 요약이 있으면 합쳐서 하나로 업데이트해.

이전 요약: ${prevSummary || '없음'}

새 대화:
${unsummarized.map((m: { role: string; content: string }) => `${m.role === 'user' ? '나' : 'AI'}: ${m.content}`).join('\n')}

요약:`

      const summaryResult = await callAssistantLLMWithProvider(
        [{ role: 'user', content: summaryPrompt }],
        '너는 대화 요약 도우미야. 핵심만 간결하게 요약해.',
        validProvider
      )

      await updateSmalltalkConversation(conversationId, {
        summary: summaryResult.content,
        last_messages: { summarizedUpTo: chatMessages.length } as any,
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
    const SUMMARY_EVERY = 20  // 20턴마다 요약
    const chatMessages = messages.filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant')

    // 현재 대화의 요약 + 요약 이후 메시지 수 불러오기
    let currentSummary = ''
    let summarizedUpTo = 0  // 몇 번째 메시지까지 요약됐는지
    if (conversationId) {
      const conv = await getSmalltalkConversation(conversationId)
      currentSummary = conv?.summary || ''
      summarizedUpTo = (conv?.last_messages as any)?.summarizedUpTo ?? 0
    }

    // 요약 안 된 메시지들
    const unsummarizedMessages = chatMessages.slice(summarizedUpTo)

    // 20턴 도달 시 자동 요약
    if (unsummarizedMessages.length >= SUMMARY_EVERY && conversationId) {
      const toSummarize = unsummarizedMessages  // 요약 안 된 전체
      const summaryPrompt = `다음은 잡담 대화야. 이름, 나이, 직업 등 사실 정보와 주요 토픽을 포함해서 3~7문장으로 요약해줘. 이전 요약이 있으면 합쳐서 하나로 업데이트해.

이전 요약: ${currentSummary || '없음'}

새 대화:
${toSummarize.map((m: { role: string; content: string }) => `${m.role === 'user' ? '나' : 'AI'}: ${m.content}`).join('\n')}

요약:`

      const summaryResult = await callAssistantLLMWithProvider(
        [{ role: 'user', content: summaryPrompt }],
        '너는 대화 요약 도우미야. 핵심만 간결하게 요약해.',
        validProvider
      )

      currentSummary = summaryResult.content
      summarizedUpTo = chatMessages.length  // 현재까지 전부 요약됨

      // 요약 저장
      await updateSmalltalkConversation(conversationId, {
        summary: currentSummary,
        last_messages: { summarizedUpTo } as any,
      })
    }

    // LLM에 보낼 메시지: 요약 이후 메시지들
    const messagesForLLM = chatMessages.slice(summarizedUpTo)

    // system prompt에 누적 요약 주입
    const contextSummary = currentSummary ? `\n\n[이전 대화 기억]: ${currentSummary}` : ''
    const systemPrompt = `너는 가볍게 수다 떠는 잡담 비서야. 친근하고 짧은 응답을 선호해. 한국어로 대화해.${contextSummary}`

    // chatHandler의 maxMessages 슬라이싱 우회 (직접 제어)
    const result = await callSmallTalkLLM(messagesForLLM, systemPrompt, validProvider)

    const firstUserMessage = chatMessages[0]?.content

    return NextResponse.json({
      content: result.content,
      provider: result.provider,
      availableProviders: ALL_PROVIDERS,
      firstUserMessage: !body.conversationId ? firstUserMessage : undefined,
    })
  } catch (err) {
    console.error('LLM call error:', err)
    return NextResponse.json({ ok: false, error: String(err), availableProviders: ALL_PROVIDERS }, { status: 500 })
  }
}
