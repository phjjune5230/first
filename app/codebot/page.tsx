'use client'

import { useState, useEffect, useRef } from 'react'
import { ALL_PROVIDERS } from '@/lib/llm'

type Message = {
  role: 'user' | 'assistant'
  content: string
}

type Change = {
  path: string
  content: string
  description: string
  sha: string
}

type PendingChanges = {
  changes: Change[]
  summary: string
}

type CommitRecord = {
  beforeSha: string  // 롤백 기준점 (커밋 전 SHA)
  summary: string
  time: string
}

type CommitHistory = {
  sha: string
  message: string
  date: string
}

type Mode = 'home' | 'chat' | 'rollback'

export default function CodebotPage() {
  const [mode, setMode] = useState<Mode>('home')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState(ALL_PROVIDERS[0])

  // 커밋 대기 중인 변경사항
  const [pendingChanges, setPendingChanges] = useState<PendingChanges | null>(null)
  // 커밋 버튼 표시 여부
  const [showCommitBtn, setShowCommitBtn] = useState(false)
  // 이번 세션 커밋 기록 (롤백용)
  const [commitRecords, setCommitRecords] = useState<CommitRecord[]>([])

  // 롤백 모드
  const [commitHistory, setCommitHistory] = useState<CommitHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // diff 모달
  const [expandedDiff, setExpandedDiff] = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, showCommitBtn])

  function addMsg(msg: Message) {
    setMessages(prev => [...prev, msg])
  }

  // ── 수정 모드 진입 ──────────────────────────────
  function enterChat() {
    setMode('chat')
    setMessages([{ role: 'assistant', content: '안녕하세요! 어떤 코드를 검토하거나 수정할까요?\n예: "english봇 검토해줘", "stock 페이지 이 부분 고쳐줘"' }])
    setPendingChanges(null)
    setShowCommitBtn(false)
  }

  // ── 롤백 모드 진입 ──────────────────────────────
  async function enterRollback() {
    setMode('rollback')
    setHistoryLoading(true)
    try {
      const res = await fetch('/api/codebot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_history', provider: selectedProvider }),
      })
      const data = await res.json()
      if (data.ok) setCommitHistory(data.history)
    } catch (err) {
      console.error(err)
    } finally {
      setHistoryLoading(false)
    }
  }

  // ── 메시지 전송 ─────────────────────────────────
  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    addMsg({ role: 'user', content: text })
    setLoading(true)
    setShowCommitBtn(false) // 새 메시지 오면 일단 버튼 숨김

    try {
      const res = await fetch('/api/codebot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, { role: 'user', content: text }],
          provider: selectedProvider,
        }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)

      // modify: pendingChanges 저장
      if (data.intent === 'modify' && data.pendingChanges) {
        setPendingChanges(data.pendingChanges)
      }

      // approve / commit: 커밋 버튼 표시
      if (data.intent === 'approve' || data.intent === 'commit') {
        if (pendingChanges) {
          setShowCommitBtn(true)
        } else {
          // pendingChanges 없으면 그냥 대화
          data.content = '아직 수정된 내용이 없어요. 먼저 수정할 내용을 말씀해주세요.'
        }
      }

      // rollback intent: 롤백 모드로 전환
      if (data.intent === 'rollback') {
        addMsg({ role: 'assistant', content: data.content })
        await enterRollback()
        return
      }

      addMsg({ role: 'assistant', content: data.content })

    } catch (err) {
      addMsg({ role: 'assistant', content: `❌ 오류: ${String(err)}` })
    } finally {
      setLoading(false)
    }
  }

  // ── 커밋 실행 ───────────────────────────────────
  async function handleCommit() {
    if (!pendingChanges) return
    setShowCommitBtn(false)
    setLoading(true)
    addMsg({ role: 'assistant', content: 'GitHub에 푸시 중...' })

    try {
      const res = await fetch('/api/codebot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'commit', pendingChanges, provider: selectedProvider }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)

      // 롤백용 기록 저장 (커밋 전 SHA)
      setCommitRecords(prev => [{
        beforeSha: data.beforeSha,
        summary: pendingChanges.summary,
        time: new Date().toLocaleTimeString('ko-KR'),
      }, ...prev])

      setMessages(prev => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = {
          role: 'assistant',
          content: `${data.message}\nVercel 자동 재배포 시작돼요.\n\n다른 수정이 필요하면 말씀해주세요!`,
        }
        return msgs
      })
      setPendingChanges(null)
    } catch (err) {
      setMessages(prev => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = { role: 'assistant', content: `❌ 커밋 실패: ${String(err)}` }
        return msgs
      })
      setShowCommitBtn(true) // 실패하면 버튼 다시 표시
    } finally {
      setLoading(false)
    }
  }

  // ── 롤백 실행 ───────────────────────────────────
  async function handleRollback(sha: string, label: string) {
    setHistoryLoading(true)
    try {
      const res = await fetch('/api/codebot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rollback', rollbackSha: sha, provider: selectedProvider }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      setCommitHistory([])
      setMode('home')
      alert(`✅ "${label}" 시점으로 롤백 완료`)
    } catch (err) {
      alert(`❌ 롤백 실패: ${String(err)}`)
    } finally {
      setHistoryLoading(false)
    }
  }

  // ── diff 내용 ───────────────────────────────────
  const diffChange = pendingChanges?.changes.find(c => c.path === expandedDiff)

  return (
    <main
      className="min-h-screen bg-[#0f0f0f] text-white flex flex-col"
      style={{ fontFamily: "'DM Mono', monospace" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700&display=swap');
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0f0f0f; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        .msg-user { background: #1a1a1a; border-left: 2px solid #e8ff47; }
        .msg-assistant { background: transparent; border-left: 2px solid #333; }
        textarea { resize: none; font-size: 16px; }
        .blink { animation: blink 1s step-end infinite; }
        @keyframes blink { 50% { opacity: 0; } }
        .diff-add { color: #4ade80; }
        .diff-del { color: #f87171; }
      `}</style>

      {/* 헤더 */}
      <header className="border-b border-[#222] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {mode !== 'home' && (
            <button
              onClick={() => setMode('home')}
              className="text-[#444] hover:text-[#e8ff47] text-xs transition-colors"
            >
              ← 홈
            </button>
          )}
          {mode === 'home' && (
            <a href="/" className="text-[#444] hover:text-[#e8ff47] text-xs transition-colors">← 메인</a>
          )}
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700 }} className="text-lg tracking-tight">
            코드봇
          </h1>
          {mode === 'chat' && (
            <span className="text-xs text-[#444]">수정 모드</span>
          )}
          {mode === 'rollback' && (
            <span className="text-xs text-[#444]">롤백 모드</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-[#888]">
          <span>LLM:</span>
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="bg-[#111] border border-[#333] text-white text-xs rounded px-2 py-1 outline-none"
          >
            {ALL_PROVIDERS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </header>

      {/* diff 모달 */}
      {expandedDiff && diffChange && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setExpandedDiff(null)}
        >
          <div
            className="bg-[#111] border border-[#333] rounded max-w-3xl w-full max-h-[80vh] overflow-auto p-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-[#888]">{expandedDiff}</span>
              <button onClick={() => setExpandedDiff(null)} className="text-[#555] hover:text-white text-xs">✕ 닫기</button>
            </div>
            <p className="text-xs text-[#666] mb-3">{diffChange.description}</p>
            <pre className="text-xs leading-5 whitespace-pre-wrap text-[#888]">
              {diffChange.content}
            </pre>
          </div>
        </div>
      )}

      {/* ── HOME ───────────────────────────────────── */}
      {mode === 'home' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
          <div className="text-center">
            <p style={{ fontFamily: "'Syne', sans-serif" }} className="text-2xl font-bold mb-2">코드봇</p>
            <p className="text-xs text-[#555]">GitHub 레포를 대화로 수정해요</p>
          </div>
          <div className="flex flex-col gap-3 w-full max-w-xs">
            <button
              onClick={enterChat}
              className="border border-[#333] py-4 text-sm rounded hover:border-[#e8ff47] hover:text-[#e8ff47] transition-colors"
            >
              ✏️ 코드 수정
            </button>
            <button
              onClick={enterRollback}
              className="border border-[#333] py-4 text-sm rounded hover:border-[#e8ff47] hover:text-[#e8ff47] transition-colors"
            >
              ↩️ 롤백
            </button>
          </div>
          {commitRecords.length > 0 && (
            <div className="w-full max-w-xs">
              <p className="text-xs text-[#444] mb-2">이번 세션 커밋</p>
              {commitRecords.map((r, i) => (
                <div key={i} className="text-xs text-[#555] py-1 border-b border-[#1a1a1a]">
                  {r.time} · {r.summary}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── CHAT ───────────────────────────────────── */}
      {mode === 'chat' && (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 max-w-3xl mx-auto w-full">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`px-4 py-3 rounded-sm text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user' ? 'msg-user' : 'msg-assistant'
                }`}
              >
                <span className={`text-xs font-medium mr-2 ${msg.role === 'user' ? 'text-[#e8ff47]' : 'text-[#555]'}`}>
                  {msg.role === 'user' ? 'you' : 'bot'}
                </span>
                {msg.content}
              </div>
            ))}

            {/* 수정된 파일 목록 */}
            {pendingChanges && (
              <div className="pl-4 flex flex-wrap gap-2">
                {pendingChanges.changes.map(c => (
                  <button
                    key={c.path}
                    onClick={() => setExpandedDiff(c.path)}
                    className="text-xs border border-[#333] px-3 py-1.5 rounded hover:border-[#e8ff47] hover:text-[#e8ff47] transition-colors"
                  >
                    📄 {c.path.split('/').pop()}
                  </button>
                ))}
              </div>
            )}

            {/* 커밋 버튼 */}
            {showCommitBtn && pendingChanges && !loading && (
              <div className="flex gap-3 pl-4">
                <button
                  onClick={handleCommit}
                  className="border border-[#e8ff47] text-[#e8ff47] text-sm px-6 py-2.5 rounded hover:bg-[#e8ff47] hover:text-black transition-colors"
                >
                  🚀 커밋 & 푸시
                </button>
                <button
                  onClick={() => setShowCommitBtn(false)}
                  className="border border-[#333] text-[#555] text-sm px-4 py-2.5 rounded hover:border-[#555] transition-colors"
                >
                  취소
                </button>
              </div>
            )}

            {loading && (
              <div className="msg-assistant px-4 py-3 rounded-sm text-sm text-[#555]">
                <span className="text-xs font-medium mr-2">bot</span>
                <span className="blink">▊</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* 입력창 - 항상 열려있음 */}
          <div className="border-t border-[#222] px-4 py-4 max-w-3xl mx-auto w-full">
            <div className="flex gap-3 items-end">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder="검토하거나 수정할 내용을 말해주세요"
                rows={3}
                className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-4 py-3 text-sm text-white placeholder-[#444] focus:outline-none focus:border-[#e8ff47] transition-colors"
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="bg-[#e8ff47] text-black text-xs font-bold px-4 rounded hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed h-[72px]"
                style={{ fontFamily: "'Syne', sans-serif" }}
              >
                전송
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── ROLLBACK ────────────────────────────────── */}
      {mode === 'rollback' && (
        <div className="flex-1 overflow-y-auto px-4 py-6 max-w-3xl mx-auto w-full">
          <p className="text-sm text-[#888] mb-4">어느 시점으로 롤백할까요?</p>

          {historyLoading && (
            <p className="text-xs text-[#555]">히스토리 불러오는 중...</p>
          )}

          {!historyLoading && commitHistory.length === 0 && (
            <p className="text-xs text-[#555]">커밋 히스토리가 없어요.</p>
          )}

          <div className="space-y-2">
            {commitHistory.map((c, i) => (
              <div
                key={c.sha}
                className="border border-[#222] rounded px-4 py-3 flex items-center justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{c.message}</p>
                  <p className="text-xs text-[#555] mt-0.5">
                    {c.sha.slice(0, 7)} · {new Date(c.date).toLocaleString('ko-KR')}
                  </p>
                </div>
                {i > 0 && ( // 가장 최신 커밋은 롤백 불필요
                  <button
                    onClick={() => handleRollback(c.sha, c.message)}
                    disabled={historyLoading}
                    className="text-xs border border-red-500 text-red-400 px-3 py-1.5 rounded hover:bg-red-500 hover:text-white transition-colors disabled:opacity-30 shrink-0"
                  >
                    이 시점으로
                  </button>
                )}
                {i === 0 && (
                  <span className="text-xs text-[#444] shrink-0">현재</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}
