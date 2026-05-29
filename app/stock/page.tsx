'use client'

import ChatWindow from '@/components/ChatWindow'

export default function StockPage() {
  return (
    <ChatWindow
      title="주식 비서"
      apiPath="/api/stock"
      greeting="안녕하세요! 주식 비서예요. 종목 분석, 뉴스 요약, 포트폴리오 관련해서 물어보세요."
    />
  )
}
