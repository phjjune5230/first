import { supabase } from './supabase'

// ↓ 기능별 LLM 우선순위 설정
export const ENGLISH_LLM_PRIORITY = ['gemini', 'groq', 'gpt-oss', 'openai', 'deepseek', 'kimi', 'glm', 'grok', 'claude']
export const ASSISTANT_LLM_PRIORITY = ['groq', 'gemini', 'gpt-oss', 'openai', 'deepseek', 'kimi', 'glm', 'grok', 'claude']
export const STOCK_LLM_PRIORITY = ['gemini', 'groq', 'gpt-oss', 'openai', 'deepseek', 'kimi', 'glm', 'grok', 'claude']

// ↓ 리셋 방식 설정: 'midnight' | 'hours'
const RESET_MODE: 'midnight' | 'hours' = 'midnight'
const RESET_HOURS = 5
const ERROR_THRESHOLD = 3

type LLMState = {
  current_provider: string
  error_counts: Record<string, number>
  last_error_at: Record<string, string>
}

type CallLLMResult = {
  content: string
  provider: string
}

async function getLLMState(): Promise<LLMState> {
  const { data } = await supabase.from('llm_state').select('*').eq('id', 1).single()
  return {
    // DB에 값이 없을 때 특정 공급자('gemini')로 강제하지 않고
    // 빈 문자열을 반환해 호출 시 우선순위 배열의 첫 항목을 사용하도록 한다.
    current_provider: data?.current_provider || '',
    error_counts: data?.error_counts || {},
    last_error_at: data?.last_error_at || {},
  }
}

async function updateLLMState(updates: Partial<LLMState>) {
  await supabase.from('llm_state').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', 1)
}

function shouldReset(provider: string, state: LLMState): boolean {
  const lastError = state.last_error_at[provider]
  if (!lastError) return true

  if (RESET_MODE === 'midnight') {
    const lastDate = new Date(lastError).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
    const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
    return lastDate !== today
  } else {
    const hoursPassed = (Date.now() - new Date(lastError).getTime()) / 1000 / 3600
    return hoursPassed >= RESET_HOURS
  }
}

async function recordError(provider: string, state: LLMState, priority: string[]) {
  const errorCounts = { ...state.error_counts }
  const lastErrorAt = { ...state.last_error_at }

  if (shouldReset(provider, state)) {
    errorCounts[provider] = 1
  } else {
    errorCounts[provider] = (errorCounts[provider] || 0) + 1
  }
  lastErrorAt[provider] = new Date().toISOString()

  let currentProvider = state.current_provider
  if (errorCounts[provider] >= ERROR_THRESHOLD) {
    const currentIdx = priority.indexOf(provider)
    if (currentIdx < priority.length - 1) {
      currentProvider = priority[currentIdx + 1]
      console.log(`LLM 전환: ${provider} → ${currentProvider}`)
    }
  }

  await updateLLMState({ current_provider: currentProvider, error_counts: errorCounts, last_error_at: lastErrorAt })
}

async function callProvider(provider: string, messages: { role: string; content: string }[], systemPrompt: string): Promise<string> {
  if (provider === 'gemini') {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite', systemInstruction: systemPrompt })
    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }))
    const firstUserIdx = history.findIndex(m => m.role === 'user')
    const chat = model.startChat({ history: firstUserIdx >= 0 ? history.slice(firstUserIdx) : [] })
    const result = await chat.sendMessage(messages[messages.length - 1].content)
    return result.response.text()
  }

  if (provider === 'groq') {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
      }),
    })
    const data = await res.json()
    if (!data.choices?.[0]?.message?.content) throw new Error(JSON.stringify(data))
    return data.choices[0].message.content
  }

  if (provider === 'gpt-oss') {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
      }),
    })
    const data = await res.json()
    if (!data.choices?.[0]?.message?.content) throw new Error(JSON.stringify(data))
    return data.choices[0].message.content
  }

  if (provider === 'openai') {
    const { default: OpenAI } = await import('openai')
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: systemPrompt }, ...messages] as never,
    })
    return completion.choices[0].message.content || ''
  }

  if (provider === 'deepseek') {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
      }),
    })
    const data = await res.json()
    return data.choices[0].message.content
  }

  if (provider === 'kimi') {
    const res = await fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.KIMI_API_KEY}` },
      body: JSON.stringify({
        model: 'moonshot-v1-8k',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
      }),
    })
    const data = await res.json()
    return data.choices[0].message.content
  }

  if (provider === 'glm') {
    const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GLM_API_KEY}` },
      body: JSON.stringify({
        model: 'glm-4-flash',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
      }),
    })
    const data = await res.json()
    return data.choices[0].message.content
  }

  if (provider === 'grok') {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROK_API_KEY}` },
      body: JSON.stringify({
        model: 'grok-3-mini',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
      }),
    })
    const data = await res.json()
    return data.choices[0].message.content
  }

  if (provider === 'claude') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      }),
    })
    const data = await res.json()
    return data.content[0].text
  }

  throw new Error(`Unknown provider: ${provider}`)
}

async function callLLMWithPriority(messages: { role: string; content: string }[], systemPrompt: string, priority: string[], selectedProvider?: string): Promise<CallLLMResult> {
  const state = await getLLMState()
  let provider = state.current_provider

  const invalidProviders = Object.entries(state.error_counts)
    .filter(([, count]) => count >= ERROR_THRESHOLD)
    .map(([p]) => p)

  if (selectedProvider && !invalidProviders.includes(selectedProvider) && priority.includes(selectedProvider)) {
    provider = selectedProvider
  } else if (!provider || !priority.includes(provider) || invalidProviders.includes(provider)) {
    provider = priority.find((p) => !invalidProviders.includes(p)) || priority[0]
  }

  const startIdx = priority.indexOf(provider)
  const orderedProviders = startIdx >= 0 ? [...priority.slice(startIdx), ...priority.slice(0, startIdx)] : priority

  for (const p of orderedProviders) {
    if (invalidProviders.includes(p)) {
      console.log(`[LLM] ${p}는 에러 제한 초과로 건너뜁니다.`)
      continue
    }

    try {
      console.log(`[LLM] 호출: ${p}`)
      const result = await callProvider(p, messages, systemPrompt)
      return { content: result, provider: p }
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status
      console.log(`[LLM] ${p} 호출 실패:`, err)
      await recordError(p, state, priority)
      if (status === 429 || status === 503) {
        continue
      }
      continue
    }
  }

  throw new Error('모든 LLM 호출 실패')
}

export async function callEnglishLLM(messages: { role: string; content: string }[], systemPrompt: string): Promise<CallLLMResult> {
  return callLLMWithPriority(messages, systemPrompt, ENGLISH_LLM_PRIORITY)
}

export async function callEnglishLLMWithProvider(messages: { role: string; content: string }[], systemPrompt: string, selectedProvider?: string): Promise<CallLLMResult> {
  return callLLMWithPriority(messages, systemPrompt, ENGLISH_LLM_PRIORITY, selectedProvider)
}

export async function callAssistantLLM(messages: { role: string; content: string }[], systemPrompt: string): Promise<CallLLMResult> {
  return callLLMWithPriority(messages, systemPrompt, ASSISTANT_LLM_PRIORITY)
}

export async function callAssistantLLMWithProvider(messages: { role: string; content: string }[], systemPrompt: string, selectedProvider?: string): Promise<CallLLMResult> {
  return callLLMWithPriority(messages, systemPrompt, ASSISTANT_LLM_PRIORITY, selectedProvider)
}

export async function callStockLLM(messages: { role: string; content: string }[], systemPrompt: string): Promise<CallLLMResult> {
  return callLLMWithPriority(messages, systemPrompt, STOCK_LLM_PRIORITY)
}
