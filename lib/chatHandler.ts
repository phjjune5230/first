import { callEnglishLLMWithProvider, callAssistantLLM, callAssistantLLMWithProvider, callStockLLM, ALL_PROVIDERS } from './llm'
import { supabase } from './supabase'

export type ChatHandlerOptions = {
  maxMessages?: number
  type: 'english' | 'smalltalk' | 'stock' | 'assistant'
}

export type ExampleItem = {
  speaker: string
  sentence: string
  translation?: string
  type?: 'example' | 'output_prompt'
}

export type ChatHandlerResponse = {
  content: string
  provider: string
  availableProviders: string[]
  disabledProviders?: string[]
  examples?: ExampleItem[]
}

type LLMResult = { content: string; provider: string }

async function getDisabledProviders(): Promise<string[]> {
  const { data } = await supabase.from('llm_state').select('error_counts').eq('id', 1).single()
  return Object.entries(data?.error_counts || {})
    .filter(([, count]) => typeof count === 'number' && count >= 3)
    .map(([p]) => p)
}

export async function handleChat(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  selectedProvider: string | undefined,
  options: ChatHandlerOptions
): Promise<ChatHandlerResponse> {
  const filteredMessages = options.maxMessages ? messages.slice(-options.maxMessages) : messages
  const disabledProviders = await getDisabledProviders()

  let result: LLMResult
  if (options.type === 'english') {
    result = await callEnglishLLMWithProvider(filteredMessages, systemPrompt, selectedProvider)
  } else if (options.type === 'smalltalk') {
    result = await callAssistantLLMWithProvider(filteredMessages, systemPrompt, selectedProvider)
  } else if (options.type === 'stock') {
    result = await callStockLLM(filteredMessages, systemPrompt, selectedProvider!)
  } else {
    result = await callAssistantLLM(filteredMessages, systemPrompt)
  }

  const content = `[${result.provider}] ${result.content}`
  return { content, provider: result.provider, availableProviders: ALL_PROVIDERS, disabledProviders }
}

export async function handleEnglishChat(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  selectedProvider: string | undefined,
  options: ChatHandlerOptions
): Promise<ChatHandlerResponse> {
  const filteredMessages = options.maxMessages ? messages.slice(-options.maxMessages) : messages
  const disabledProviders = await getDisabledProviders()

  const result = await callEnglishLLMWithProvider(filteredMessages, systemPrompt, selectedProvider)
  const parsedResult = parseExampleResponse(result.content)
  const content = parsedResult.text ? `[${result.provider}] ${parsedResult.text}` : `[${result.provider}] ${result.content}`

  return { content, provider: result.provider, availableProviders: ALL_PROVIDERS, disabledProviders, examples: parsedResult.examples }
}

export function parseExampleResponse(raw: string) {
  const cleaned = raw.replace(/```json|```/g, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).examples)) {
      const examples: ExampleItem[] = (parsed as any).examples
        .filter((item: any) => item && typeof item === 'object')
        .map((item: any) => ({
          speaker: String(item.speaker || item.role || 'Example'),
          sentence: String(item.sentence ?? item.text ?? ''),
          translation: item.translation ? String(item.translation) : undefined,
          type: item.type === 'output_prompt' ? 'output_prompt' : 'example',
        }))
        .filter((item: ExampleItem) => item.sentence)
      return { text: typeof parsed.text === 'string' ? parsed.text.trim() : '', examples }
    }
  } catch (err) {
    console.error('[parseExampleResponse] JSON parse failed:', err, '\nraw:', raw.slice(0, 200))
  }
  return { text: '', examples: [] as ExampleItem[] }
}