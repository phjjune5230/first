'use client'

import { useState, useEffect, useRef } from 'react'
import { speakText, type TTSLanguage, getLanguageLabel, getAllLanguages } from '@/lib/speech'

export type Message = {
  role: 'user' | 'assistant'
  content: string
  speaker?: string
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
  showLanguageSelector?: boolean
}

// 음성 속도 선택지: 0.8 ~ 1.4, 0.05 단위
const SPEECH_RATES = [
  { label: '0.80x', value: 0.8 },
  { label: '0.85x', value: 0.85 },
  { label: '0.90x', value: 0.9 },
  { label: '0.95x', value: 0.95 },
  { label: '1.00x', value: 1.0 },
  { label: '1.05x', value: 1.05 },
  { label: '1.10x', value: 1.1 },
  { label: '1.15x', value: 1.15 },
  { label: '1.20x', value: 1.2 },
  { label: '1.25x', value: 1.25 },
  { label: '1.30x', value: 1.3 },
  { label: '1.35x', value: 1.35 },
  { label: '1.40x', value: 1.4 },
]

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
  showLanguageSelector = false,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionActive, setSessionActive] = useState(false)
  const [selectedLang, setSelectedLang] = useState<TTSLanguage>('en-US')
  const [selectedRate, setSelectedRate] = useState(1.1)
  const [speaking, setSpeaking] = useState(false)
  const [showUndoButton, setShowUndoButton] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMessages([{ role: 'assistant', content: greeting }])
    setSessionActive(true)
  }, [greeting])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSpeak(text: string) {
    setSpeaking(true)
    try {
      await speakText(text, selectedLang, selectedRate)
    } catch (e) {
      console.error('Speech error:', e)
    } finally {
      setSpeaking(false)
    }
  }

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
        body: JSON.stringify({ messages: newMessages.map(({ role, content }) => ({ role, content })), ...(extraRequestData ?? {}) }),
      })
      const data = await res.json()
      onApiResponse?.(data)

      const content = processContent ? processContent(data.content ?? data.text ?? '') : data.content ?? data.text ?? ''
      const nextMessages: Message[] = [...newMessages]

      if (Array.isArray(data.examples)) {
        if (content) {
          nextMessages.push({ role: 'assistant', content })
        }
        data.examples.forEach((item: any) => {
          if (!item || typeof item !== 'object') return
          const text = item.sentence ?? item.text ?? ''  // ← sentence 대신 text 변수명 사용
          if (!text) return
          nextMessages.push({ role: 'assistant', content: text, speaker: item.speaker ?? 'Example' })  // ← speaker 필드 제거
        })
      } else {
        nextMessages.push({ role: 'assistant', content })
      }

      setMessages(nextMessages)
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
        setShowUndoButton(true)
        onSessionSaved?.()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
      setSessionActive(false)
    }
  }

  async function undoDay() {
    setLoading(true)
    try {
      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'undo_day' }),
      })
      const data = await res.json()
      if (data.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.message,
          },
        ])
        setShowUndoButton(false)
        onSessionSaved?.()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
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

      {showLanguageSelector && (
        <div className="border-b border-[#222] px-6 py-3 bg-[#0a0a0a]">
          <div className="flex gap-4 items-center">
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#555]">발음 억양:</label>
              <select
                value={selectedLang}
                onChange={(e) => setSelectedLang(e.target.value as TTSLanguage)}
                className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#e8ff47]"
              >
                {getAllLanguages().map((lang) => (
                  <option key={lang} value={lang}>
                    {getLanguageLabel(lang)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#555]">음성 속도:</label>
              <select
                value={selectedRate}
                onChange={(e) => setSelectedRate(parseFloat(e.target.value))}
                className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#e8ff47]"
              >
                {SPEECH_RATES.map((rate) => (
                  <option key={rate.value} value={rate.value}>
                    {rate.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 max-w-2xl mx-auto w-full">
        {messages.map((msg, i) => (
          <div key={i} className={`px-4 py-3 rounded-sm text-sm leading-relaxed whitespace-pre-wrap ${msg.role === 'user' ? 'msg-user' : 'msg-assistant'}`}>
            <span className={`text-xs font-medium mr-2 ${msg.role === 'user' ? 'text-[#e8ff47]' : 'text-[#555]'}`}>
              {msg.role === 'user' ? 'you' : msg.speaker ? msg.speaker : 'ai'}
            </span>
            <div className="inline-block">
              {msg.content}
              {msg.role === 'assistant' && showLanguageSelector && (
                <button
                  onClick={() => handleSpeak(msg.content.replace(/\[.*?\]\s/, ''))}
                  disabled={speaking}
                  className="ml-2 text-[#e8ff47] hover:text-white transition-colors disabled:opacity-40 text-xs"
                  title="음성으로 읽어주기"
                >
                  🔊
                </button>
              )}
            </div>
          </div>
        ))}
        {showUndoButton && (
          <div className="px-4 py-3 rounded-sm text-xs">
            <button
              onClick={undoDay}
              disabled={loading}
              className="border border-[#333] px-3 py-1.5 rounded hover:border-[#e8ff47] hover:text-[#e8ff47] transition-colors disabled:opacity-40"
            >
              다시 하기
            </button>
          </div>
        )}
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
