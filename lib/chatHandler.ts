import { callEnglishLLMWithProvider, callAssistantLLM, callAssistantLLMWithProvider, callStockLLM, ALL_PROVIDERS } from './llm'
import { supabase } from './supabase'

export type ChatHandlerOptions = {
  maxMessages?: number
  checkContextNeed?: boolean
  useContext?: boolean
  type: 'english' | 'smalltalk' | 'stock' | 'assistant'
}

export type ChatHandlerResponse = {
  content: string
  provider: string
  availableProviders: string[]
  disabledProviders?: string[]
  examples?: Array<{ speaker: string; sentence: string }>
  [key: string]: any
}

/**
 * 모든 비서의 메시지 처리를 담당하는 중앙 핸들러
 * - 메시지 필터링
 * - LLM 호출
 * - 응답 파싱
 * - 에러 처리
 */
export async function handleChat(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  selectedProvider: string | undefined,
  options: ChatHandlerOptions
): Promise<ChatHandlerResponse> {
  const { maxMessages, type } = options

  // 1. 메시지 필터링
  const filteredMessages = maxMessages ? messages.slice(-maxMessages) : messages

  // 2. LLM 호출 (type별로 다른 함수 사용)
  let result
  if (type === 'english') {
    if (!selectedProvider) throw new Error('LLM provider를 선택해주세요.')
    result = await callEnglishLLMWithProvider(filteredMessages, systemPrompt, selectedProvider)
  } else if (type === 'smalltalk') {
    if (!selectedProvider) throw new Error('LLM provider를 선택해주세요.')
    result = await callAssistantLLMWithProvider(filteredMessages, systemPrompt, selectedProvider)
  } else if (type === 'stock') {
    if (!selectedProvider) throw new Error('LLM provider를 선택해주세요.')
    result = await callStockLLM(filteredMessages, systemPrompt, selectedProvider)
  } else if (type === 'assistant') {
    // assistant는 priority 기반
    result = await callAssistantLLM(filteredMessages, systemPrompt)
  }

  // 3. 비활성화된 provider 확인
  const { data } = await supabase.from('llm_state').select('error_counts').eq('id', 1).single()
  const disabledProviders = Object.entries(data?.error_counts || {})
    .filter(([, count]) => typeof count === 'number' && count >= 3)
    .map(([p]) => p)

  // 4. 응답 포맷팅
  const content = `[${result.provider}] ${result.content}`

  return {
    content,
    provider: result.provider,
    availableProviders: ALL_PROVIDERS,
    disabledProviders,
  }
}

/**
 * English 비서 전용 - 추가 파싱 로직 포함
 */
export async function handleEnglishChat(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  selectedProvider: string | undefined,
  options: ChatHandlerOptions
): Promise<ChatHandlerResponse> {
  const { maxMessages } = options

  const filteredMessages = maxMessages ? messages.slice(-maxMessages) : messages

  if (!selectedProvider) throw new Error('LLM provider를 선택해주세요.')
  const result = await callEnglishLLMWithProvider(filteredMessages, systemPrompt, selectedProvider)

  const { data } = await supabase.from('llm_state').select('error_counts').eq('id', 1).single()
  const disabledProviders = Object.entries(data?.error_counts || {})
    .filter(([, count]) => typeof count === 'number' && count >= 3)
    .map(([p]) => p)

  // English 특화: 예제 파싱
  const parsedResult = parseExampleResponse(result.content)
  const content = parsedResult.text ? `[${result.provider}] ${parsedResult.text}` : `[${result.provider}] ${result.content}`

  return {
    content,
    provider: result.provider,
    availableProviders: ALL_PROVIDERS,
    disabledProviders,
    examples: parsedResult.examples,
  }
}

/**
 * 메시지 필터링 유틸
 */
export function filterMessages(messages: Array<{ role: string; content: string }>, limit: number) {
  return messages.slice(-limit)
}

/**
 * 응답에서 예제 파싱 (English 비서용)
 */
function parseExampleResponse(raw: string) {
  const cleaned = raw.replace(/```json|```/g, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).examples)) {
      const examples = (parsed as any).examples
        .filter((item: any) => item && typeof item === 'object')
        .map((item: any) => ({
          speaker: String(item.speaker || item.role || 'Example'),
          sentence: String(item.sentence ?? item.text ?? ''),
        }))
        .filter((item: any) => item.sentence)
      return {
        text: typeof parsed.text === 'string' ? parsed.text.trim() : '',
        examples,
      }
    }
  } catch {
    // fallback
  }
  return { text: '', examples: [] }
}
