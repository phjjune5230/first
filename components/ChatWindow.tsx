'use client'

import { useState, useEffect, useRef } from 'react'
import { speakText, speakWithGroq, startListening, stopListening, type TTSLanguage, type TTSMode, type GroqStyle, getLanguageLabel, getAllLanguages } from '@/lib/speech'

export type Message = {
  role: 'user' | 'assistant'
  content: string
  translation?: string
  type?: 'text' | 'example' | 'output_prompt'
  speaker?: string
  speakerIndex?: number
}

type Props = {
  title: string
  subtitle?: string
  apiPath: string
  greeting: string
  initialMessages?: Array<{ role: string; content: string }>
  onSessionSaved?: () => void
  extraHeader?: React.ReactNode
  extraRequestData?: Record<string, unknown>
  extraRequestDataRef?: React.MutableRefObject<Record<string, unknown>>
  onApiResponse?: (data: any) => void
  processContent?: (content: string) => string
  showLanguageSelector?: boolean
}

const SPEECH_RATES = [
  { label: '0.8x', value: 0.8 },
  { label: '0.9x', value: 0.9 },
  { label: '1.0x', value: 1.0 },
  { label: '1.1x', value: 1.1 },
  { label: '1.2x', value: 1.2 },
  { label: '1.3x', value: 1.3 },
  { label: '1.4x', value: 1.4 },
  { label: '1.5x', value: 1.5 },
  { label: '1.6x', value: 1.6 },
  { label: '1.7x', value: 1.7 },
  { label: 'Groq', value: 'groq' },
]

const GROQ_STYLE_OPTIONS: { label: string; value: GroqStyle }[] = [
  { label: 'Natural',    value: 'natural' },
  { label: 'Confident',  value: 'confident' },
  { label: 'Fast',       value: 'fast' },
  { label: 'Excited',    value: 'excited' },
]

export default function ChatWindow({
  title,
  subtitle,
  apiPath,
  greeting,
  initialMessages,
  onSessionSaved,
  extraHeader,
  extraRequestData,
  extraRequestDataRef,
  onApiResponse,
  processContent,
  showLanguageSelector = false,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionActive, setSessionActive] = useState(false)
  const [selectedLang, setSelectedLang] = useState<TTSLanguage>('en-US')
  const [selectedMode, setSelectedMode] = useState<TTSMode>('groq')
  const [groqStyle, setGroqStyle] = useState<GroqStyle>('natural')
  const [speaking, setSpeaking] = useState(false)
  const [listening, setListening] = useState(false)
  const [listeningForIndex, setListeningForIndex] = useState<number | null>(null)
  const [useWhisper, setUseWhisper] = useState(true)
  const [showUndoButton, setShowUndoButton] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const audioCacheRef = useRef<Map<string, string>>(new Map()) // cacheKey → objectURL

  // 컴포넌트 unmount 시 objectURL 일괄 해제
  useEffect(() => {
    return () => {
      audioCacheRef.current.forEach(url => URL.revokeObjectURL(url))
      audioCacheRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (initialMessages && initialMessages.length > 0) {
      const restored = initialMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
      setMessages([...restored, { role: 'assistant', content: greeting }])
    } else {
      setMessages([{ role: 'assistant', content: greeting }])
    }
    setSessionActive(true)
  }, [greeting])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSpeak(text: string, speakerIndex?: number) {
    setSpeaking(true)
    try {
      if (selectedMode === 'groq') {
        const cacheKey = `${text}__${groqStyle}`
        const cached = audioCacheRef.current.get(cacheKey)
        if (cached) {
          await new Promise<void>((resolve, reject) => {
            const audio = new Audio(cached)
            audio.onended = () => resolve()
            audio.onerror = () => reject(new Error('Audio 재생 실패'))
            audio.play()
          })
        } else {
          // API 호출 후 objectURL 캐싱
          const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, speakerIndex, style: groqStyle }),
          })
          if (!res.ok) throw new Error('Groq TTS 호출 실패')
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          audioCacheRef.current.set(cacheKey, url)
          await new Promise<void>((resolve, reject) => {
            const audio = new Audio(url)
            audio.onended = () => resolve()
            audio.onerror = () => reject(new Error('Audio 재생 실패'))
            audio.play()
          })
        }
      } else {
        await speakText(text, selectedLang, selectedMode as number, speakerIndex)
      }
    } catch (e) {
      console.error('Speech error:', e)
    } finally {
      setSpeaking(false)
    }
  }

  async function handleListen(targetIndex: number) {
    if (listening) {
      stopListening()
      setListening(false)
      setListeningForIndex(null)
      return
    }
    setListening(true)
    setListeningForIndex(targetIndex)
    try {
      const transcript = await startListening(useWhisper)
      setInput(transcript)
    } catch (e) {
      console.error('Listen error:', e)
    } finally {
      setListening(false)
      setListeningForIndex(null)
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
      // API에 보낼 때: user 전체 + assistant 중 type:'text'인 것만 (examples는 UI 전용)
      const historyForAPI = newMessages
        .filter(m => m.role === 'user' || m.type === 'text' || m.type === undefined)
        .map(({ role, content }) => ({ role, content }))

      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: historyForAPI, ...(extraRequestDataRef?.current ?? extraRequestData ?? {}) }),
      })
      const data = await res.json()
      onApiResponse?.(data)

      const content = processContent ? processContent(data.content ?? data.text ?? '') : data.content ?? data.text ?? ''
      const nextMessages: Message[] = [...newMessages]

      if (Array.isArray(data.examples)) {
        if (content) {
          nextMessages.push({ role: 'assistant', content, type: 'text' })
        }
        const speakerList: string[] = []
        data.examples.forEach((item: any) => {
          if (!item || typeof item !== 'object') return
          const text = item.sentence ?? item.text ?? ''
          if (!text) return
          const rawSpeaker = item.speaker ?? ''
          if (rawSpeaker && !speakerList.includes(rawSpeaker)) {
            speakerList.push(rawSpeaker)
          }
          const speakerIndex = rawSpeaker ? speakerList.indexOf(rawSpeaker) : undefined
          const speakerLabel = speakerIndex !== undefined ? String.fromCharCode(65 + speakerIndex) : undefined
          const msgType: Message['type'] = item.type === 'output_prompt' ? 'output_prompt' : 'example'
          nextMessages.push({ role: 'assistant', content: text, translation: item.translation ?? undefined, type: msgType, speaker: speakerLabel, speakerIndex })
        })
      } else {
        nextMessages.push({ role: 'assistant', content, type: 'text' })
      }

      setMessages(nextMessages)

      // Groq 모드일 때 예문 전체 미리 캐싱 (백그라운드)
      if (selectedMode === 'groq' && Array.isArray(data.examples)) {
        const toCache = data.examples
          .filter((item: any) => item?.sentence || item?.text)
          .map((item: any) => ({ text: item.sentence ?? item.text ?? '', speakerIndex: item.speakerIndex }))
        toCache.forEach(({ text, speakerIndex }: { text: string; speakerIndex?: number }) => {
          const cacheKey = `${text}__${groqStyle}`
          if (!audioCacheRef.current.has(cacheKey)) {
            fetch('/api/tts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text, speakerIndex, style: groqStyle }),
            }).then(res => res.ok ? res.blob() : null)
              .then(blob => { if (blob) audioCacheRef.current.set(cacheKey, URL.createObjectURL(blob)) })
              .catch(() => {})
          }
        })
      }
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
        body: JSON.stringify({ messages, action: 'save_session', ...(extraRequestDataRef?.current ?? extraRequestData ?? {}) }),
      })
      const data = await res.json()
      if (data.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `✅ 저장 완료!\n📝 요약: ${data.log.summary}\n💡 메모: ${data.log.notes}`,
            type: 'text',
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
          { role: 'assistant', content: data.message, type: 'text' },
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
        .msg-output-prompt { background: transparent; border-left: 2px solid #4a9eff; }
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
                disabled={selectedMode === 'groq'}
                className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#e8ff47] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {getAllLanguages().map((lang) => (
                  <option key={lang} value={lang}>
                    {getLanguageLabel(lang)}
                  </option>
                ))}
              </select>
              {selectedMode === 'groq' && (
                <span className="text-[10px] text-[#444]">Groq 선택 시 미국식 고정</span>
              )}
            </div>
            {selectedMode === 'groq' && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-[#555]">말하기 스타일:</label>
                <select
                  value={groqStyle}
                  onChange={(e) => setGroqStyle(e.target.value as GroqStyle)}
                  className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#e8ff47]"
                >
                  {GROQ_STYLE_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#555]">음성 인식:</label>
              <select
                value={useWhisper ? 'whisper' : 'webspeech'}
                onChange={(e) => setUseWhisper(e.target.value === 'whisper')}
                className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#e8ff47]"
              >
                <option value="whisper">Whisper</option>
                <option value="webspeech">Web Speech</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#555]">음성 속도:</label>
              <select
                value={selectedMode === 'groq' ? 'groq' : String(selectedMode)}
                onChange={(e) => setSelectedMode(e.target.value === 'groq' ? 'groq' : parseFloat(e.target.value))}
                className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#e8ff47]"
              >
                {SPEECH_RATES.map((rate) => (
                  <option key={String(rate.value)} value={String(rate.value)}>
                    {rate.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 max-w-2xl mx-auto w-full">
        {messages.map((msg, i) => {
          const isExample = msg.type === 'example'
          const isOutputPrompt = msg.type === 'output_prompt'
          const isUser = msg.role === 'user'

          return (
            <div
              key={i}
              className={`px-4 py-3 rounded-sm text-sm leading-relaxed whitespace-pre-wrap ${
                isUser ? 'msg-user' : isOutputPrompt ? 'msg-output-prompt' : 'msg-assistant'
              }`}
            >
              <span className={`text-xs font-medium mr-2 ${isUser ? 'text-[#e8ff47]' : isOutputPrompt ? 'text-[#4a9eff]' : 'text-[#555]'}`}>
                {isUser ? 'you' : isExample ? (msg.speaker ?? 'ex') : isOutputPrompt ? '📝 output' : 'ai'}
              </span>
              <div className="inline-block">
                {msg.content}
                {/* 예문에만 🔊 버튼 */}
                {isExample && showLanguageSelector && (
                  <button
                    onClick={() => handleSpeak(msg.content, msg.speakerIndex)}
                    disabled={speaking}
                    className="ml-2 text-[#e8ff47] hover:text-white transition-colors disabled:opacity-40 text-xs"
                    title="음성으로 읽어주기"
                  >
                    🔊
                  </button>
                )}
                {/* 한글 번역 */}
                {isExample && msg.translation && (
                  <div className="mt-1 text-xs text-[#666]">
                    {msg.translation}
                  </div>
                )}
                {/* 아웃풋 프롬프트에만 🎙 버튼 */}
                {isOutputPrompt && showLanguageSelector && (
                  <button
                    onClick={() => handleListen(i)}
                    disabled={speaking}
                    className={`ml-2 transition-colors text-xs ${
                      listening && listeningForIndex === i
                        ? 'text-red-400 animate-pulse'
                        : 'text-[#4a9eff] hover:text-white disabled:opacity-40'
                    }`}
                    title={listening && listeningForIndex === i ? '녹음 중지' : '음성으로 답하기'}
                  >
                    {listening && listeningForIndex === i ? '⏹' : '🎙'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
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
