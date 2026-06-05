'use client'

import { useState, useEffect, useRef } from 'react'
import { ALL_PROVIDERS } from '@/lib/llm'

type Phase =
  | 'idle'
  | 'input'
  | 'planning'
  | 'wait_approve'
  | 'generating'
  | 'wait_commit'
  | 'committing'
  | 'done'
  | 'rollback'

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
}

export default function CodebotPage() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: '안녕하세요! 코드봇이에요.\n무엇을 할까요?' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState(ALL_PROVIDERS[0])
  const [userRequest, setUserRequest] = useState('')
  const [plannedFiles, setPlannedFiles] = useState<string[]>([])
  const [pendingChanges, setPendingChanges] = useState<{ changes: Change[]; summary: string } | null>(null)
  const [lastCommitSha, setLastCommitSha] = useState<string | null>(null)
  const [expandedDiff, setExpandedDiff] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  function addMsg(msg: Message) {
    setMessages(prev => [...prev, msg])
  }

  async function handleAction(action: '수정' | '롤백') {
    if (action === '수정') {
      addMsg({ role: 'user', content: '수정' })
      addMsg({ role: 'assistant', content: '어떻게 수정할까요? 원하는 내용을 자유롭게 말해주세요.' })
      setPhase('input')
    } else {
      addMsg({ role: 'user', content: '롤백' })
      if (!lastCommitSha) {
        addMsg({ role: 'assistant', content: '이번 세션에서 커밋한 기록이 없어요.' })
        return
      }
      setPhase('rollback')
      addMsg({ role: 'assistant', content: `마지막 커밋(${lastCommitSha.slice(0, 7)}) 이전으로 롤백할까요?` })
    }
  }

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
      const diffText = data.changes.map((c: Change) => `📄 ${c.path}\n${c.description}`).join('\n\n')
      setMessages(prev => {
        const msgs = [...prev]
        msgs[msgs.length -
