'use client'

import { useRouter } from 'next/navigation'

// ↓ 메뉴 추가/수정 시 여기만 편집
const MENUS = [
  { id: 'todo', label: 'to do list', desc: '오늘/이번주/전체/기타', path: '/assistant/todo' },
  { id: 'add', label: '목표 추가', desc: '새 목표 입력', path: '/assistant/add' },
  { id: 'edit', label: '목표 수정', desc: '기존 목표 수정', path: '/assistant/edit' },
  { id: 'smalltalk', label: '잡담', desc: '가볍게 수다 떨기', path: '/smalltalk' },
  { id: 'done', label: '완료된 일정', desc: '완료 목록 조회', path: '/assistant/done' },
]

export default function AssistantPage() {
  const router = useRouter()

  return (
    <main className="min-h-screen bg-[#0f0f0f] text-white flex flex-col items-center justify-center px-6" style={{ fontFamily: "'DM Mono', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700&display=swap');
      `}</style>

      <div className="max-w-md w-full">
        <div className="flex items-center gap-3 mb-1">
          <a href="/" className="text-[#444] hover:text-[#e8ff47] text-xs transition-colors">← 홈</a>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700 }} className="text-xl tracking-tight">
            개인 비서
          </h1>
        </div>
        <p className="text-xs text-[#444] mb-10">무엇을 도와드릴까요?</p>

        <div className="space-y-3">
          {MENUS.map((m, i) => (
            <button
              key={m.id}
              onClick={() => router.push(m.path)}
              className="w-full text-left border border-[#222] px-5 py-4 rounded hover:border-[#e8ff47] transition-colors group"
            >
              <div className="flex items-center gap-3">
                <span className="text-[#333] text-xs group-hover:text-[#e8ff47] transition-colors">{i + 1}.</span>
                <div>
                  <p style={{ fontFamily: "'Syne', sans-serif" }} className="text-sm font-semibold">{m.label}</p>
                  <p className="text-xs text-[#444] mt-0.5">{m.desc}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </main>
  )
}
