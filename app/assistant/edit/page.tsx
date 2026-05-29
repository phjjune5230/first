'use client'

import { useState, useEffect, useRef } from 'react'
import { getGoals, Goal } from '@/lib/assistant'

type Message = { role: 'user' | 'assistant'; content: string }

export default function EditPage() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadGoals()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function loadGoals() {
    const data = await getGoals()
    setGoals(data)
    setMessages([{
      role: 'assistant',
      content: `수정할 목표를 말씀해주세요.\n\n현재 목표 목록:\n${data.map(g => `${g.id}. [${g.category}] ${g.subcategory} / ${g.status} / ${g.due_date || '일정없음'}`).join('\n')}`
    }])
  }

  async function sendMessage() {
    if (!input.trim() || loading) return
    const userMsg: Message = { role: 'user', content: input }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, action: 'edit_goal' }),
      })
      const data = await res.json()
      setMessages([...newMessages, { role: 'assistant', content: data.content }])
      if (data.ok) loadGoals()
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
        .msg-user { background: #1a1a1a; border-left: 2px solid #e8ff47; }
        .msg-assistant { background: transparent; border-left: 2px solid #333; }
        textarea { resize: none; }
        .blink { animation: blink 1s step-end infinite; }
        @keyframes blink { 50% { opacity: 0; } }
      `}</style>

      <header className="border-b border-[#222] px-6 py-4 flex items-center gap-3">
        <a href="/assistant" className="text-[#444] hover:text-[#e8ff47] text-xs transition-colors">← 비서</a>
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700 }} className="text-lg">목표 수정</h1>
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
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
            placeholder="예: 3번 목표 일정을 2026-06-30으로 바꿔줘"
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
      </div>
    </main>
  )
}
