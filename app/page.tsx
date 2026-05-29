'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// ↓ 비밀번호 변경 시 여기만 수정
const PASSWORD = '123456'

const features = [
  { id: 'english', label: '영어 공부', desc: '커리큘럼 설계 · 회화 · 문법 교정', path: '/english' },
  { id: 'stock', label: '주식 비서', desc: '종목 분석 · 뉴스 요약 · 포트폴리오', path: '/stock' },
  { id: 'assistant', label: '개인 비서', desc: '목표 관리 · 일정 추적', path: '/assistant' },
  { id: 'smalltalk', label: '잡담', desc: '가볍게 수다 떨기', path: '/smalltalk' },
]

export default function Home() {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [error, setError] = useState(false)

  function handleInput(digit: string) {
    if (input.length >= 6) return
    const next = input + digit
    setInput(next)
    setError(false)

    if (next.length === 6) {
      if (next === PASSWORD) {
        setUnlocked(true)
      } else {
        setError(true)
        setTimeout(() => setInput(''), 600)
      }
    }
  }

  function handleDelete() {
    setInput((prev) => prev.slice(0, -1))
    setError(false)
  }

  if (!unlocked) {
    return (
      <main className="min-h-screen bg-[#0f0f0f] text-white flex flex-col items-center justify-center px-6" style={{ fontFamily: "'DM Mono', monospace" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700&display=swap');`}</style>

        <div className="max-w-xs w-full flex flex-col items-center gap-8">
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700 }} className="text-3xl tracking-tight">
            카리나
          </h1>

          <div className="flex gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={`w-3 h-3 rounded-full border transition-colors ${error ? 'border-red-500 bg-red-500' : i < input.length ? 'border-[#e8ff47] bg-[#e8ff47]' : 'border-[#333]'}`} />
            ))}
          </div>

          {error && <p className="text-xs text-red-400 -mt-4">비밀번호가 틀렸어요</p>}

          <div className="grid grid-cols-3 gap-3 w-full">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((key, i) => (
              <button
                key={i}
                onClick={() => key === '⌫' ? handleDelete() : key !== '' ? handleInput(key) : null}
                disabled={key === ''}
                className={`h-14 rounded text-xl font-medium transition-colors ${key === '' ? 'invisible' : key === '⌫' ? 'border border-[#222] text-[#555] hover:text-white hover:border-[#444]' : 'border border-[#222] hover:border-[#e8ff47] hover:text-[#e8ff47]'}`}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#0f0f0f] text-white flex flex-col items-center justify-center px-6" style={{ fontFamily: "'DM Mono', monospace" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700&display=swap');`}</style>

      <div className="max-w-md w-full">
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700 }} className="text-2xl tracking-tight mb-1">
          Welcome June
        </h1>
        <p className="text-xs text-[#444] mb-10">어떤 기능을 사용할까요?</p>

        <div className="space-y-3">
          {features.map((f, i) => (
            <button
              key={f.id}
              onClick={() => router.push(f.path)}
              className="w-full text-left border border-[#222] px-5 py-4 rounded hover:border-[#e8ff47] transition-colors group"
            >
              <div className="flex items-center gap-3">
                <span className="text-[#333] text-xs group-hover:text-[#e8ff47] transition-colors">{i + 1}.</span>
                <div>
                  <p style={{ fontFamily: "'Syne', sans-serif" }} className="text-sm font-semibold">{f.label}</p>
                  <p className="text-xs text-[#444] mt-0.5">{f.desc}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </main>
  )
}
