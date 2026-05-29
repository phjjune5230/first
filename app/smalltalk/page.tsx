'use client'

import { useState } from 'react'
import ChatWindow from '@/components/ChatWindow'
import { ASSISTANT_LLM_PRIORITY } from '@/lib/llm'

export default function SmalltalkPage() {
  const [selectedProvider, setSelectedProvider] = useState('')
  const [disabledProviders, setDisabledProviders] = useState<string[]>([])

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
              <option value="">자동 선택</option>
              {ASSISTANT_LLM_PRIORITY.map((provider) => (
                <option key={provider} value={provider} disabled={disabledProviders.includes(provider)}>
                  {provider}{disabledProviders.includes(provider) ? ' (비활성)' : ''}
                </option>
              ))}
            </select>
          </div>
          {disabledProviders.length > 0 && (
            <p className="text-[10px] text-[#555]">
              비활성 LLM: {disabledProviders.join(', ')}
            </p>
          )}
        </div>
      }
      extraRequestData={selectedProvider ? { provider: selectedProvider } : undefined}
      onApiResponse={(data) => {
        if (Array.isArray(data?.disabledProviders)) {
          setDisabledProviders(data.disabledProviders)
          if (data.disabledProviders.includes(selectedProvider)) {
            setSelectedProvider('')
          }
        }
      }}
    />
  )
}
