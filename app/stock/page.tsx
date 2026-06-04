'use client'

import { useState, useEffect, useRef } from 'react'
import { ALL_PROVIDERS } from '@/lib/llm'

type Message = {
  role: 'user' | 'assistant'
  content: string
  display?: 'chat' | 'table' | 'table+chart' | 'ask'
  rows?: any[]
  displayOptions?: string[]
  pendingSql?: string
}

export default function StockPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: '안녕하세요! 주식 비서예요.\n삼성전자 최근 1개월 주가, KOSPI 거래량 상위 종목 등 DB 기반으로 답해드려요.' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState(ALL_PROVIDERS[0])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(overrideContent?: string, extraBody?: Record<string, any>) {
    const text = overrideContent ?? input.trim()
    if (!text || loading) return

    const userMsg: Message = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(({ role, content }) => ({ role, content })),
          provider: selectedProvider,
          ...extraBody,
        }),
      })
      const data = await res.json()

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.content ?? '',
        display: data.display ?? 'chat',
        rows: data.rows,
        displayOptions: data.displayOptions,
        pendingSql: data.pendingSql,
      }])
    } catch (e) {
      console.error(e)
      setMessages(prev => [...prev, { role: 'assistant', content: '오류가 발생했어요. 다시 시도해주세요.' }])
    } finally {
      setLoading(false)
    }
  }

  // 표현 방식 선택 후 재요청
  async function handleDisplayChoice(choice: string, pendingSql: string | undefined, msgIndex: number) {
    const displayMap: Record<string, string> = {
      '채팅': 'chat', '테이블': 'table', '그래프': 'table+chart'
    }
    const choiceMsg = `${choice}으로 보여줘`
    // 해당 ask 메시지를 선택 표시로 교체
    setMessages(prev => prev.map((m, i) =>
      i === msgIndex ? { ...m, display: 'chat', content: m.content + `\n→ "${choice}" 선택됨` } : m
    ))
    await sendMessage(choiceMsg)
  }

  async function endSession() {
    if (messages.length < 2) return
    setLoading(true)
    try {
      const res = await fetch('/api/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, action: 'save_session', provider: selectedProvider }),
      })
      const data = await res.json()
      if (data.ok) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ 저장 완료!\n📝 요약: ${data.log.summary}\n💡 메모: ${data.log.notes}`,
        }])
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
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
        table { border-collapse: collapse; width: 100%; font-size: 12px; }
        th { background: #1a1a1a; color: #e8ff47; padding: 6px 10px; text-align: right; border-bottom: 1px solid #2a2a2a; }
        th:first-child { text-align: left; }
        td { padding: 5px 10px; text-align: right; border-bottom: 1px solid #1a1a1a; color: #ccc; }
        td:first-child { text-align: left; color: #fff; }
        tr:hover td { background: #1a1a1a; }
      `}</style>

      <header className="border-b border-[#222] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <a href="/" className="text-[#444] hover:text-[#e8ff47] text-xs transition-colors">← 홈</a>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700 }} className="text-lg tracking-tight">
            주식 비서
          </h1>
        </div>
        <div className="flex items-center gap-3">
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
          {messages.length > 2 && (
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

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 max-w-3xl mx-auto w-full">
        {messages.map((msg, i) => (
          <div key={i}>
            <div className={`px-4 py-3 rounded-sm text-sm leading-relaxed whitespace-pre-wrap ${
              msg.role === 'user' ? 'msg-user' : 'msg-assistant'
            }`}>
              <span className={`text-xs font-medium mr-2 ${msg.role === 'user' ? 'text-[#e8ff47]' : 'text-[#555]'}`}>
                {msg.role === 'user' ? 'you' : 'ai'}
              </span>
              {msg.content}
            </div>

            {/* 표현 방식 선택 버튼 */}
            {msg.display === 'ask' && msg.displayOptions && (
              <div className="mt-2 flex gap-2 pl-4">
                {msg.displayOptions.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => handleDisplayChoice(opt, msg.pendingSql, i)}
                    disabled={loading}
                    className="text-xs border border-[#333] px-3 py-1.5 rounded hover:border-[#e8ff47] hover:text-[#e8ff47] transition-colors disabled:opacity-40"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {/* 테이블 */}
            {(msg.display === 'table' || msg.display === 'table+chart') && msg.rows && msg.rows.length > 0 && (
              <div className="mt-2 overflow-x-auto border border-[#222] rounded">
                <StockTable rows={msg.rows} />
              </div>
            )}

            {/* 차트 */}
            {msg.display === 'table+chart' && msg.rows && msg.rows.length > 0 && (
              <div className="mt-2">
                <StockChart rows={msg.rows} />
              </div>
            )}
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

      <div className="border-t border-[#222] px-4 py-4 max-w-3xl mx-auto w-full">
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
            placeholder="예: 삼성전자 최근 1개월 주가를 테이블로 보여줘"
            rows={2}
            className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-4 py-3 text-sm text-white placeholder-[#444] focus:outline-none focus:border-[#e8ff47] transition-colors"
          />
          <button
            onClick={() => sendMessage()}
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

// ── 테이블 컴포넌트 ──────────────────────────────────
function StockTable({ rows }: { rows: any[] }) {
  if (!rows.length) return null
  const cols = Object.keys(rows[0])

  function formatCell(key: string, val: any): string {
    if (val === null || val === undefined) return '-'
    if (key === 'volume') return Number(val).toLocaleString()
    if (['open', 'high', 'low', 'close'].includes(key)) {
      const n = Number(val)
      // 한국 주식 (원화) vs 미국 주식 (달러) 구분 — close > 1000이면 원화로 간주
      return n > 1000 ? n.toLocaleString() + '원' : '$' + n.toFixed(2)
    }
    return String(val)
  }

  const COL_LABEL: Record<string, string> = {
    ticker: '종목코드', name: '종목명', market: '시장', date: '날짜',
    open: '시가', high: '고가', low: '저가', close: '종가', volume: '거래량',
  }

  return (
    <table>
      <thead>
        <tr>
          {cols.map(c => <th key={c}>{COL_LABEL[c] ?? c}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {cols.map(c => <td key={c}>{formatCell(c, row[c])}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── 차트 컴포넌트 (SVG 라인차트) ─────────────────────
function StockChart({ rows }: { rows: any[] }) {
  // date + close 컬럼이 있을 때만 렌더링
  const hasData = rows.length > 1 && 'close' in rows[0] && 'date' in rows[0]
  if (!hasData) return null

  const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const closes = sorted.map(r => Number(r.close))
  const dates = sorted.map(r => String(r.date))

  const W = 600, H = 200, PAD = { top: 16, right: 16, bottom: 32, left: 60 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  const minV = Math.min(...closes)
  const maxV = Math.max(...closes)
  const range = maxV - minV || 1

  function xPos(i: number) { return PAD.left + (i / (closes.length - 1)) * chartW }
  function yPos(v: number) { return PAD.top + chartH - ((v - minV) / range) * chartH }

  const polyline = closes.map((v, i) => `${xPos(i)},${yPos(v)}`).join(' ')

  // x축 레이블: 최대 6개
  const step = Math.max(1, Math.floor(dates.length / 6))
  const xLabels = dates.filter((_, i) => i % step === 0 || i === dates.length - 1)
  const xLabelIdxs = xLabels.map(d => dates.indexOf(d))

  // y축 레이블: 4개
  const yTicks = [0, 0.33, 0.66, 1].map(t => minV + t * range)

  const isKrw = maxV > 1000

  return (
    <div className="border border-[#222] rounded p-2 bg-[#0a0a0a]">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }}>
        {/* 그리드 */}
        {yTicks.map((v, i) => (
          <line key={i} x1={PAD.left} x2={W - PAD.right} y1={yPos(v)} y2={yPos(v)}
            stroke="#1e1e1e" strokeWidth="1" />
        ))}
        {/* y축 레이블 */}
        {yTicks.map((v, i) => (
          <text key={i} x={PAD.left - 6} y={yPos(v) + 4} textAnchor="end"
            fill="#555" fontSize="10">
            {isKrw ? v.toLocaleString() : '$' + v.toFixed(1)}
          </text>
        ))}
        {/* x축 레이블 */}
        {xLabelIdxs.map((idx, i) => (
          <text key={i} x={xPos(idx)} y={H - 4} textAnchor="middle"
            fill="#555" fontSize="9">
            {dates[idx].slice(5)} {/* MM-DD */}
          </text>
        ))}
        {/* 라인 */}
        <polyline points={polyline} fill="none" stroke="#e8ff47" strokeWidth="1.5" />
        {/* 첫/마지막 점 */}
        <circle cx={xPos(0)} cy={yPos(closes[0])} r="3" fill="#e8ff47" />
        <circle cx={xPos(closes.length - 1)} cy={yPos(closes[closes.length - 1])} r="3" fill="#e8ff47" />
      </svg>
    </div>
  )
}
