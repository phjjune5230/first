'use client'

import { useState, useEffect } from 'react'
import ChatWindow from '@/components/ChatWindow'
import { ALL_PROVIDERS } from '@/lib/llm'

type Conversation = {
  id: string
  title: string
  summary: string | null
  last_messages: Array<{ role: string; content: string }>
  created_at: string
  updated_at: string
}

type View = 'list' | 'chat'

export default function SmalltalkPage() {
  const [view, setView] = useState<View>('list')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null)
  const [selectedProvider, setSelectedProvider] = useState(ALL_PROVIDERS[0])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    fetchConversations()
  }, [])

  async function fetchConversations() {
    setLoading(true)
    try {
      const res = await fetch('/api/smalltalk')
      const data = await res.json()
      setConversations(data.conversations || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  // 새 대화 시작
  async function startNewChat() {
    setSelectedConv(null)
    setView('chat')
  }

  // 이어하기
  function continueChat(conv: Conversation) {
    setSelectedConv(conv)
    setView('chat')
  }

  // 대화 삭제
  async function deleteConversation(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (!confirm('이 대화를 삭제할까요?')) return
    setDeletingId(id)
    try {
      await fetch('/api/smalltalk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: id }),
      })
      setConversations(prev => prev.filter(c => c.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  // 목록으로 돌아오기 (세션 저장 후)
  function handleSessionSaved() {
    fetchConversations()
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return '오늘'
    if (diffDays === 1) return '어제'
    if (diffDays < 7) return `${diffDays}일 전`
    return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
  }

  // ── 채팅 화면 ─────────────────────────────────────
  if (view === 'chat') {
    const greeting = selectedConv
      ? `어, 왔어요! ${selectedConv.summary ? `저번에 ${selectedConv.summary.slice(0, 30)}… 얘기했던 것 기억해요. 이어서 얘기해요!` : '이어서 수다 떨어요!'}`
      : '안녕! 가볍게 수다 떨래요? 오늘 기분은 어때요?'

    // 이어하기일 때 초기 메시지로 last_messages 복원
    const initialMessages = selectedConv?.last_messages?.length
      ? selectedConv.last_messages
      : undefined

    return (
      <div>
        {/* 목록으로 돌아가기 버튼 (ChatWindow 위에 오버레이) */}
        <div className="fixed top-0 left-0 z-10 px-4 py-4">
          <button
            onClick={() => { setView('list'); fetchConversations() }}
            className="text-xs text-[#444] hover:text-[#e8ff47] transition-colors"
          >
            ← 대화 목록
          </button>
        </div>
        <ChatWindow
          title="잡담"
          subtitle={selectedConv ? `이어하기: ${selectedConv.title}` : '새 대화'}
          apiPath="/api/smalltalk"
          greeting={greeting}
          initialMessages={initialMessages}
          onSessionSaved={handleSessionSaved}
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
                    <option key={provider} value={provider}>{provider}</option>
                  ))}
                </select>
              </div>
            </div>
          }
          extraRequestData={{
            provider: selectedProvider,
            conversationId: selectedConv?.id || null,
            // 새 대화면 첫 메시지 후 conversation 생성 필요
            isNewConversation: !selectedConv,
          }}
        />
      </div>
    )
  }

  // ── 대화 목록 화면 ────────────────────────────────
  return (
    <main
      className="min-h-screen bg-[#0f0f0f] text-white flex flex-col"
      style={{ fontFamily: "'DM Mono', monospace" }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700&display=swap');`}</style>

      <header className="border-b border-[#222] px-6 py-4">
        <div className="flex items-center gap-2">
          <a href="/" className="text-[#444] hover:text-[#e8ff47] text-xs transition-colors">← 홈</a>
          <h1
            style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700 }}
            className="text-lg tracking-tight"
          >
            잡담
          </h1>
        </div>
        <p className="text-xs text-[#666] mt-0.5">가볍게 수다 떨기</p>
      </header>

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">

        {/* 새 대화 버튼 */}
        <button
          onClick={startNewChat}
          className="w-full border border-[#e8ff47] text-[#e8ff47] px-5 py-4 rounded mb-6 text-sm font-semibold hover:bg-[#e8ff47] hover:text-black transition-colors"
          style={{ fontFamily: "'Syne', sans-serif" }}
        >
          + 새 대화 시작
        </button>

        {/* 과거 대화 목록 */}
        {loading ? (
          <div className="text-xs text-[#444] text-center py-8">불러오는 중...</div>
        ) : conversations.length === 0 ? (
          <div className="text-xs text-[#444] text-center py-8">아직 대화 기록이 없어요</div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-[#444] mb-3">이어하기</p>
            {conversations.map((conv, i) => (
              <button
                key={conv.id}
                onClick={() => continueChat(conv)}
                className="w-full text-left border border-[#222] px-5 py-4 rounded hover:border-[#555] transition-colors group relative"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="text-[#333] text-xs group-hover:text-[#666] transition-colors mt-0.5 shrink-0">
                      {i + 1}.
                    </span>
                    <div className="min-w-0">
                      <p
                        style={{ fontFamily: "'Syne', sans-serif" }}
                        className="text-sm font-semibold truncate"
                      >
                        {conv.title}
                      </p>
                      {conv.summary && (
                        <p className="text-xs text-[#444] mt-0.5 line-clamp-1">
                          {conv.summary.slice(0, 50)}…
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-[#333]">{formatDate(conv.updated_at)}</span>
                    <button
                      onClick={(e) => deleteConversation(e, conv.id)}
                      disabled={deletingId === conv.id}
                      className="text-[#333] hover:text-red-400 transition-colors text-xs opacity-0 group-hover:opacity-100 px-1"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
