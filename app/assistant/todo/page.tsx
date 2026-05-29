'use client'

import { useState, useEffect } from 'react'
import { getGoals, Goal } from '@/lib/assistant'

type Filter = '오늘' | '이번주' | '전체' | '기타'

function getThisSunday() {
  const d = new Date()
  const day = d.getDay()
  const diff = 7 - day
  const sunday = new Date(d)
  sunday.setDate(d.getDate() + diff)
  sunday.setHours(23, 59, 59)
  return sunday
}

export default function TodoPage() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [filter, setFilter] = useState<Filter>('오늘')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  useEffect(() => { loadGoals() }, [])

  async function loadGoals() {
    const data = await getGoals()
    setGoals(data.filter(g => g.status !== '완료'))
  }

  function filtered() {
    const today = new Date(); today.setHours(0,0,0,0)
    const todayStr = today.toISOString().split('T')[0]
    const sunday = getThisSunday()

    return goals.filter(g => {
      if (!g.due_date) return filter === '전체'
      const due = new Date(g.due_date)
      if (filter === '오늘') return g.due_date === todayStr
      if (filter === '이번주') return due <= sunday && due >= today
      if (filter === '전체') return true
      if (filter === '기타') {
        if (!customFrom || !customTo) return true
        return g.due_date >= customFrom && g.due_date <= customTo
      }
      return true
    })
  }

  const statusColor: Record<string, string> = {
    '진행중': 'text-[#e8ff47]',
    '미완료': 'text-red-400',
    '검토예정': 'text-blue-400',
  }

  return (
    <main className="min-h-screen bg-[#0f0f0f] text-white flex flex-col" style={{ fontFamily: "'DM Mono', monospace" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700&display=swap');`}</style>

      <header className="border-b border-[#222] px-6 py-4 flex items-center gap-3">
        <a href="/assistant" className="text-[#444] hover:text-[#e8ff47] text-xs transition-colors">← 비서</a>
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700 }} className="text-lg">to do list</h1>
      </header>

      <div className="px-4 py-4 max-w-2xl mx-auto w-full">
        {/* 필터 */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {(['오늘','이번주','전체','기타'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded border transition-colors ${filter === f ? 'border-[#e8ff47] text-[#e8ff47]' : 'border-[#222] text-[#555] hover:border-[#444]'}`}
            >
              {f}
            </button>
          ))}
        </div>

        {filter === '기타' && (
          <div className="flex gap-2 mb-4 items-center">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#e8ff47]" />
            <span className="text-[#444] text-xs">~</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#e8ff47]" />
          </div>
        )}

        {/* 목록 */}
        <div className="space-y-2">
          {filtered().length === 0 ? (
            <p className="text-xs text-[#444] py-8 text-center">해당 기간에 할일이 없어요</p>
          ) : filtered().map(g => (
            <div key={g.id} className="border border-[#222] rounded px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-[#555]">{g.category}</p>
                  <p className="text-sm mt-0.5">{g.subcategory}</p>
                  {g.description && <p className="text-xs text-[#444] mt-1">{g.description}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-xs font-medium ${statusColor[g.status] || 'text-[#555]'}`}>{g.status}</p>
                  {g.due_date && <p className="text-xs text-[#444] mt-0.5">{g.due_date}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
