'use client'

import { useState } from 'react'
import ChatWindow from '@/components/ChatWindow'
import { ALL_PROVIDERS } from '@/lib/llm'

export default function SmalltalkPage() {
  const [selectedProvider, setSelectedProvider] = useState(ALL_PROVIDERS[0])

  return (
    <ChatWindow
      title="잡담"
      subtitle="가볍게 수다 떨기"
      apiPath="/api/smalltalk"
      greeting={`안녕! 가볍게 수다 떨래요? 오늘 기분은 어때요?`}
      extraHeader={
        <div className="flex flex-col gap-2 text-xs text-[#888]">
          <div className="flex items-center gap-2">
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
        </div>
      }
      extraRequestData={{ provider: selectedProvider }}
    />
  )
}
