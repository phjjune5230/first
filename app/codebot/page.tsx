'use client'

import { useState, useEffect, useRef } from 'react'
import { ALL_PROVIDERS } from '@/lib/llm'

type Phase =
  | 'idle'          // 초기: 액션 선택
  | 'input'         // 요청사항 입력
  | 'planning'      // 관련 파일 파악 중
  | 'wait_approve'  // 수정 방향 확인 대기
  | 'generating'    // 수정 내용 생성 중
  | 'wait_commit'   // diff 확인 후 커밋 대기
  | 'committing'    // 커밋 중
  | 'done'          // 완료
  | 'rollback'      // 롤백 모드

type Change = {
  path: string
  content: string
  description: string
  sha: string
  diff: string
}

type Message = {
  role: 'user' | 'assistant' | 'system'
  content: string
  extra?: React.ReactNode
}

export default function CodebotPage() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: '안녕하세요! 코드봇이에요.\n무엇을 할까요?' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState(ALL_PROVIDERS[0])

  // 상태 저장
  const [userRequest, setUserRequest] = useState('')
  const [plannedFiles, setPlannedFiles] = useState<string[]>([])
  const [pendingChanges, setPendingChanges] = useState<{ changes: Change[]; summary: string } | null>(null)
  const [lastCommitSha, setLastCommitSha] = useState<string | null>(null)
  const [headSha, setHeadSha] = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  function addMsg(msg: Message) {
    setMessages(prev => [...prev, msg])
  }

  // ── 액션 선택 ─────────────────────────────────────
  async function handleAction(action: '수정' | '롤백') {
    if (action === '수정') {
      addMsg({ role: 'user', content: '수정' })
      addMsg({ role: 'assistant', content: '어떻게 수정할까요? 원하는 내용을 자유롭게 말해주세요.' })
      setPhase('input')
    } else {
      addMsg({ role: 'user', content: '롤백' })
      if (!lastCommitSha) {
        addMsg({ role: 'assistant', content: '이번 세션에서 커밋한 기록이 없어요. 수정 후 롤백이 가능해요.' })
        return
      }
      setPhase('rollback')
      addMsg({
        role: 'assistant',
        content: `마지막 커밋(${lastCommitSha.slice(0, 7)}) 이전으로 롤백할까요?`,
      })
    }
  }

  // ── 요청사항 제출 → 계획 수립 ─────────────────────
  async function handleRequestSubmit() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setUserRequest(text)
    addMsg({ role: 'user', content: text })
    setLoading(true)
    setPhase('planning')
    addMsg({ role: 'assistant', content: '관련 파일 파악 중...' })

    try {
      const res = await fetch('/api/codebot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'plan', request: text, provider: selectedProvider }),
      })
      const data = await res.json()

      if (!data.ok) throw new Error(data.error)

      setPlannedFiles(data.files)

      // 마지막 "파악 중" 메시지 교체
      setMessages(prev => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = {
          role: 'assistant',
          content: `📋 수정 계획\n\n${data.plan}\n\n수정 대상 파일:\n${data.files.map((f: string) => `  • ${f}`).join('\n')}\n\n이 방향으로 진행할까요?`,
        }
        return msgs
      })
      setPhase('wait_approve')
    } catch (err) {
      setMessages(prev => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = { role: 'assistant', content: `❌ 오류: ${String(err)}` }
        return msgs
      })
      setPhase('idle')
    } finally {
      setLoading(false)
    }
  }

  // ── 계획 승인 → 수정 내용 생성 ────────────────────
  async function handleApprove() {
    addMsg({ role: 'user', content: '네, 진행해주세요' })
    setLoading(true)
    setPhase('generating')
    addMsg({ role: 'assistant', content: '수정 내용 생성 중...' })

    try {
      const res = await fetch('/api/codebot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          request: { files: plannedFiles, userRequest },
          provider: selectedProvider,
        }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)

      setPendingChanges({ changes: data.changes, summary: data.summary })

      const diffText = data.changes
        .map((c: Change) => `📄 ${c.path}\n${c.description}`)
        .join('\n\n')

      setMessages(prev => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = {
          role: 'assistant',
          content: `✏️ 수정 내용\n\n${data.summary}\n\n${diffText}\n\n커밋할까요?`,
        }
        return msgs
      })
      setPhase('wait_commit')
    } catch (err) {
      setMessages(prev => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = { role: 'assistant', content: `❌ 오류: ${String(err)}` }
        return msgs
      })
      setPhase('idle')
    } finally {
      setLoading(false)
    }
  }

  // ── diff 펼치기/접기 상태 ──────────────────────────
  const [expandedDiff, setExpandedDiff] = useState<string | null>(null)

  // ── 커밋 ──────────────────────────────────────────
  async function handleCommit() {
    if (!pendingChanges) return
    addMsg({ role: 'user', content: '커밋해주세요' })
    setLoading(true)
    setPhase('committing')
    addMsg({ role: 'assistant', content: 'GitHub에 푸시 중...' })

    try {
      // 현재 HEAD SHA 저장
      const treeRes = await fetch('/api/codebot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_tree', provider: selectedProvider }),
      })
      const treeData = await treeRes.json()
      setHeadSha(treeData.headSha)

      const res = await fetch('/api/codebot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'commit', pendingChanges, provider: selectedProvider }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)

      setLastCommitSha(data.headSha)

      setMessages(prev => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = {
          role: 'assistant',
          content: `${data.message}\nVercel 자동 재배포 시작돼요.\n\n다른 수정이 필요하면 말해주세요!`,
        }
        return msgs
      })
      setPendingChanges(null)
      setPhase('idle')
    } catch (err) {
      setMessages(prev => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = { role: 'assistant', content: `❌ 커밋 실패: ${String(err)}` }
        return msgs
      })
      setPhase('wait_commit')
    } finally {
      setLoading(false)
    }
  }

  // ── 롤백 확인 ─────────────────────────────────────
  async function handleRollbackConfirm() {
    if (!lastCommitSha) return
    addMsg({ role: 'user', content: '롤백해주세요' })
    setLoading(true)
    addMsg({ role: 'assistant', content: '롤백 중...' })

    try {
      const res = await fetch('/api/codebot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rollback', rollbackSha: lastCommitSha, provider: selectedProvider }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)

      setLastCommitSha(null)
      setMessages(prev => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = {
          role: 'assistant',
          content: `${data.message}\n\n다른 작업이 필요하면 말해주세요!`,
        }
        return msgs
      })
      setPhase('idle')
    } catch (err) {
      setMessages(prev => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = { role: 'assistant', content: `❌ 롤백 실패: ${String(err)}` }
        return msgs
      })
      setPhase('idle')
    } finally {
      setLoading(false)
    }
  }

  // ── diff 모달 ─────────────────────────────────────
  const diffContent = pendingChanges?.changes.find(c => c.path === expandedDiff)?.diff ?? ''

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
        .msg-system { background: transparent; border-left: 2px solid #555; }
        textarea { resize: none; }
        .blink { animation: blink 1s step-end infinite; }
        @keyframes blink { 50% { opacity: 0; } }
        .diff-add { color: #4ade80; }
        .diff-del { color: #f87171; }
      `}</style>

      <header className="border-b border-[#222] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <a href="/" className="text-[#444] hover:text-[#e8ff47] text-xs transition-colors">← 홈</a>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700 }} className="text-lg tracking-tight">
            코드봇
          </h1>
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
      {expandedDiff && (
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
            <pre className="text-xs leading-5 whitespace-pre-wrap">
              {diffContent.split('\n').map((line, i) => (
                <span
                  key={i}
                  className={line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-del' : 'text-[#555]'}
                >
                  {line}{'\n'}
                </span>
              ))}
            </pre>
          </div>
        </div>
      )}

      {/* 메시지 영역 */}
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

        {/* diff 파일별 버튼 (wait_commit 상태) */}
        {phase === 'wait_commit' && pendingChanges && (
          <div className="pl-4 flex flex-wrap gap-2">
            {pendingChanges.changes.map(c => (
              <button
                key={c.path}
                onClick={() => setExpandedDiff(c.path)}
                className="text-xs border border-[#333] px-3 py-1.5 rounded hover:border-[#e8ff47] hover:text-[#e8ff47] transition-colors"
              >
                diff: {c.path.split('/').pop()}
              </button>
            ))}
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

      {/* 하단 액션 영역 */}
      <div className="border-t border-[#222] px-4 py-4 max-w-3xl mx-auto w-full">

        {/* idle: 액션 선택 버튼 */}
        {phase === 'idle' && !loading && (
          <div className="flex gap-3">
            <button
              onClick={() => handleAction('수정')}
              className="flex-1 border border-[#333] py-3 text-sm rounded hover:border-[#e8ff47] hover:text-[#e8ff47] transition-colors"
            >
              ✏️ 코드 수정
            </button>
            <button
              onClick={() => handleAction('롤백')}
              disabled={!lastCommitSha}
              className="flex-1 border border-[#333] py-3 text-sm rounded hover:border-[#e8ff47] hover:text-[#e8ff47] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ↩️ 롤백
            </button>
          </div>
        )}

        {/* input: 텍스트 입력 */}
        {phase === 'input' && (
          <div className="flex gap-3 items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleRequestSubmit()
                }
              }}
              placeholder="예: stock 페이지에서 통화 구분을 close 값이 아닌 market 컬럼 기준으로 바꿔줘"
              rows={3}
              className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-4 py-3 text-sm text-white placeholder-[#444] focus:outline-none focus:border-[#e8ff47] transition-colors"
            />
            <button
              onClick={handleRequestSubmit}
              disabled={loading || !input.trim()}
              className="bg-[#e8ff47] text-black text-xs font-bold px-4 rounded hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed h-[72px]"
              style={{ fontFamily: "'Syne', sans-serif" }}
            >
              전송
            </button>
          </div>
        )}

        {/* wait_approve: 계획 승인 */}
        {phase === 'wait_approve' && !loading && (
          <div className="flex gap-3">
            <button
              onClick={handleApprove}
              className="flex-1 border border-[#e8ff47] text-[#e8ff47] py-3 text-sm rounded hover:bg-[#e8ff47] hover:text-black transition-colors"
            >
              ✅ 진행
            </button>
            <button
              onClick={() => {
                addMsg({ role: 'user', content: '다시 할게요' })
                addMsg({ role: 'assistant', content: '알겠어요. 어떻게 수정할지 다시 말해주세요.' })
                setPhase('input')
              }}
              className="flex-1 border border-[#333] py-3 text-sm rounded hover:border-[#555] transition-colors"
            >
              ✏️ 다시
            </button>
          </div>
        )}

        {/* wait_commit: 커밋 승인 */}
        {phase === 'wait_commit' && !loading && (
          <div className="flex gap-3">
            <button
              onClick={handleCommit}
              className="flex-1 border border-[#e8ff47] text-[#e8ff47] py-3 text-sm rounded hover:bg-[#e8ff47] hover:text-black transition-colors"
            >
              🚀 커밋 & 푸시
            </button>
            <button
              onClick={() => {
                addMsg({ role: 'user', content: '취소할게요' })
                addMsg({ role: 'assistant', content: '취소됐어요. 처음부터 다시 할까요?' })
                setPendingChanges(null)
                setPhase('idle')
              }}
              className="flex-1 border border-[#333] py-3 text-sm rounded hover:border-[#555] transition-colors"
            >
              ❌ 취소
            </button>
          </div>
        )}

        {/* rollback: 롤백 확인 */}
        {phase === 'rollback' && !loading && (
          <div className="flex gap-3">
            <button
              onClick={handleRollbackConfirm}
              className="flex-1 border border-red-500 text-red-400 py-3 text-sm rounded hover:bg-red-500 hover:text-white transition-colors"
            >
              ↩️ 롤백 확인
            </button>
            <button
              onClick={() => {
                addMsg({ role: 'user', content: '취소' })
                addMsg({ role: 'assistant', content: '취소됐어요.' })
                setPhase('idle')
              }}
              className="flex-1 border border-[#333] py-3 text-sm rounded hover:border-[#555] transition-colors"
            >
              취소
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
