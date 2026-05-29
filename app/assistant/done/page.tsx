'use client'

import { useState, useEffect } from 'react'
import { getGoals, Goal } from '@/lib/assistant'

export default function DonePage() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [categoryFilter, setCategoryFilter] = useState('')
  const [categories, setCategories] = useState<string[]>([])

  useEffect(() => { loadGoals() }, [])

  async function loadGoals() {
    const data = await getGoals()
    const done = data.filter(g => g.status === '완료')
    setGoals(done)
    setCategories(Array.from(new Set(done.map(g => g.category))))
  }

  const filtered = categoryFilter ? goals.filter(g => g.category === categoryFilter) : goals

  return (
    <main className="min-h-screen bg-[#0f0f0f] text-white flex flex-col" style={{ fontFamily: "'DM Mono', monospace" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700&display=swap');`}</style>

      <header className="border-b border-[#222] px-6 py-4 flex items-center gap-3">
        <a href="/assistant" className="text-[#444] hover:text-[#e8ff47] text-xs transition-colors">← 비서</a>
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700 }} className="text-lg">완료된 일정</h1>
      </header>

      <div className="px-4 py-4 max-w-2xl mx-auto w-full">
        {/* 대분류 필터 */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <button
            onClick={() => setCategoryFilter('')}
            className={`text-xs px-3 py-1.5 rounded border transition-colors ${!categoryFilter ? 'border-[#e8ff47] text-[#e8ff47]' : 'border-[#222] text-[#555] hover:border-[#444]'}`}
          >
            전체
          </button>
          {categories.map(c => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`text-xs px-3 py-1.5 rounded border transition-colors ${categoryFilter === c ? 'border-[#e8ff47] text-[#e8ff47]' : 'border-[#222] text-[#555] hover:border-[#444]'}`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* 목록 */}
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <p className="text-xs text-[#444] py-8 text-center">완료된 일정이 없어요</p>
          ) : filtered.map(g => (
            <div key={g.id} className="border border-[#222] rounded px-4 py-3 opacity-60">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-[#555]">{g.category}</p>
                  <p className="text-sm mt-0.5 line-through">{g.subcategory}</p>
                  {g.description && <p className="text-xs text-[#444] mt-1">{g.description}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-green-400">완료</p>
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
