import { ChatHandlerOptions } from './chatHandler'

export const defaultOptions: Record<string, ChatHandlerOptions> = {
  english: {
    maxMessages: 40,  // 하루 최대 대화량 커버
    type: 'english',
  },
  smalltalk: {
    type: 'smalltalk',
  },
  stock: {
    maxMessages: 5,
    type: 'stock',
  },
  assistant: {
    maxMessages: 8,
    type: 'assistant',
  },
}

export function getDefaultOptions(name: string): ChatHandlerOptions {
  return defaultOptions[name] || defaultOptions['english']
}