import { NextRequest, NextResponse } from 'next/server'
import { handleChat } from '@/lib/chatHandler'
import { getDefaultOptions } from '@/lib/defaultOptions'
import { validateProvider } from '@/lib/validation'
import { ALL_PROVIDERS } from '@/lib/llm'

export async function POST(req: NextRequest) {
  const { messages, provider } = await req.json()
  const validProvider = validateProvider(provider)

  try {
    const systemPrompt = `너는 가볍게 수다 떠는 잡담 비서야. 친근하고 짧은 응답을 선호해. 한국어로 대화해.`
    const result = await handleChat(messages, systemPrompt, validProvider, getDefaultOptions('smalltalk'))

    return NextResponse.json({
      content: result.content,
      provider: result.provider,
      availableProviders: ALL_PROVIDERS,
      disabledProviders: result.disabledProviders,
    })
  } catch (err) {
    console.error('LLM call error:', err)
    return NextResponse.json({ ok: false, error: String(err), availableProviders: ALL_PROVIDERS }, { status: 500 })
  }
}