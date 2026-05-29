'use client'

import { useState, useEffect, useRef } from 'react'

export type Message = {
  role: 'user' | 'assistant'
  content: string
}

type Props = {
  title: string
  subtitle?: string
  apiPath: string
  greeting: string
  onSessionSaved?: () => void
  extraHeader?: React.ReactNode
  extraRequestData?: Record<string, unknown>
  onApiResponse?: (data: any) => void
  processContent?: (content: string) => string
}

export default function ChatWindow({
  title,
  subtitle,
  apiPath,
  greeting,
  onSessionSaved,
  extraHeader,
  extraRequestData,
  onApiResponse,
  processContent,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionActive, setSessionActive] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMessages([{ role: 'assistant', content: greeting }])
    setSessionActive(true)
  }, [greeting])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    if (!input.trim() || loading) return

    const userMsg: Message = { role: 'user', content: input }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, ...(extraRequestData ?? {}) }),
      })
      const data = await res.json()
      onApiResponse?.(data)
      const content = processContent ? processContent(data.content) : data.content
      setMessages([...newMessages, { role: 'assistant', content }])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function endSession() {
    if (messages.length < 2) return
    setLoading(true)

    try {
      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, action: 'save_session', ...(extraRequestData ?? {}) }),
      })
      const data = await res.json()
      if (data.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `✅ 저장 완료!\n📝 요약: ${data.log.summary}\n💡 메모: ${data.log.notes}`,
          },
        ])
        onSessionSaved?.()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
      setSessionActive(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#0f0f0f] text-white flex flex-col" style={{ fontFamily: "'DM Mono', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700&display=swap');
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0f0f0f; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        .msg-user { background: #1a1a1a; border-left: 2px solid #e8ff47; }
        .msg-assistant { background: transparent; border-left: 2px solid #333; }
        textarea { resize: none; }
        .blink { animation: blink 1s step-end infinite; }
        @keyframes blink { 50% { opacity: 0; } }
      `}</style>

      <header className="border-b border-[#222] px-6 py-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <a href="/" className="text-[#444] hover:text-[#e8ff47] text-xs transition-colors">← 홈</a>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700 }} className="text-lg tracking-tight">
              {title}
            </h1>
          </div>
          {subtitle && <p className="text-xs text-[#666] mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          {extraHeader}
          {sessionActive && messages.length > 2 && (
            <button
              onClick={endSession}
              disabled={loading}
              className="text-xs border border-[#333] px-3 py-1.5 rounded hover:border-[#e8ff47] hover:text-[#e8ff47] transition-colors disabled:opacity-40"
            >
              세션 종료 & 저장
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 max-w-2xl mx-auto w-full">
        {messages.map((msg, i) => (
          <div key={i} className={`px-4 py-3 rounded-sm text-sm leading-relaxed whitespace-pre-wrap ${msg.role === 'user' ? 'msg-user' : 'msg-assistant'}`}>
            <span className={`text-xs font-medium mr-2 ${msg.role === 'user' ? 'text-[#e8ff47]' : 'text-[#555]'}`}>
              {msg.role === 'user' ? 'you' : 'ai'}
            </span>
            {msg.content}
          </div>
        ))}
        {loading && (
          <div className="msg-assistant px-4 py-3 rounded-sm text-sm text-[#555]">
            <span className="text-xs font-medium mr-2">ai</span>
            <span className="blink">▊</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-[#222] px-4 py-4 max-w-2xl mx-auto w-full">
        <div className="flex gap-3 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            placeholder="메시지 입력... (Shift+Enter 줄바꿈)"
            rows={2}
            className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-4 py-3 text-sm text-white placeholder-[#444] focus:outline-none focus:border-[#e8ff47] transition-colors"
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="bg-[#e8ff47] text-black text-xs font-bold px-4 py-3 rounded hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed h-[52px]"
            style={{ fontFamily: "'Syne', sans-serif" }}
          >
            전송
          </button>
        </div>
        <p className="text-[10px] text-[#333] mt-2 text-center">
          끝나면 <span className="text-[#555]">세션 종료 & 저장</span> 눌러야 기록돼요
        </p>
      </div>
    </main>
  )
}
