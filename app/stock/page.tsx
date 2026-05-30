'use client'

import { useState } from 'react'
import ChatWindow from '@/components/ChatWindow'
import { ALL_PROVIDERS } from '@/lib/llm'

export default function StockPage() {
  const [selectedProvider, setSelectedProvider] = useState(ALL_PROVIDERS[0])

  return (
    <ChatWindow
      title="주식 비서"
      apiPath="/api/stock"
      greeting="안녕하세요! 주식 비서예요. 종목 분석, 뉴스 요약, 포트폴리오 관련해서 물어보세요."
      extraHeader={
        <div className="flex items-center gap-2 text-xs text-[#888]">
          <span>LLM:</span>
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="bg-[#111] border border-[#333] text-white text-xs rounded px-2 py-1 outline-none"
          >
            {ALL_PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        </div>
      }
      extraRequestData={{ provider: selectedProvider }}
    />
  )
}
