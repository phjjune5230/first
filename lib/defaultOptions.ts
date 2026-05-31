import { ChatHandlerOptions } from './chatHandler'

/**
 * 각 비서별 메시지 처리 옵션
 * 토큰 효율성을 위해 최근 메시지만 전송
 */

export const defaultOptions: Record<string, ChatHandlerOptions> = {
  english: {
    maxMessages: 10,  // 학습 context 중요하니 더 많이
    checkContextNeed: false,  // 추후 추가 예정
    useContext: false,
    type: 'english',
  },
  smalltalk: {
    maxMessages: 3,   // 잡담은 context 덜 중요
    checkContextNeed: false,
    useContext: false,
    type: 'smalltalk',
  },
  stock: {
    maxMessages: 5,   // 종목 분석은 적당한 context 필요
    checkContextNeed: false,
    useContext: false,
    type: 'stock',
  },
  assistant: {
    maxMessages: 8,   // todo 등 assistant는 task context 중요
    checkContextNeed: false,
    useContext: false,
    type: 'assistant',
  },
}

/**
 * 옵션 가져오기
 * @param name - 비서 이름 (english, smalltalk, stock, assistant)
 * @returns ChatHandlerOptions
 */
export function getDefaultOptions(name: string): ChatHandlerOptions {
  return defaultOptions[name] || defaultOptions['english']
}
