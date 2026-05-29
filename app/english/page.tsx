'use client'

import { useState, useEffect } from 'react'
import ChatWindow from '@/components/ChatWindow'
import { getState, StudyState } from '@/lib/supabase'

export default function EnglishPage() {
  const [state, setState] = useState<StudyState | null>(null)
  const [greeting, setGreeting] = useState('')

  useEffect(() => {
    loadState()
  }, [])

  async function loadState() {
    const s = await getState()
    setState(s)
    setGreeting(
      s?.curriculum
        ? `안녕하세요! ${s.current_week}주차 ${s.current_day}일 학습 시작할까요?`
        : '안녕하세요! 영어 공부 비서예요. 커리큘럼부터 같이 만들어봐요!'
    )
  }

  function processContent(content: string) {
    return content.replace('[CURRICULUM_READY]', '').replace(/\{[\s\S]*\}/, '').trim()
  }

  if (!greeting) return null

  return (
    <ChatWindow
      title="영어 공부"
      subtitle={state?.curriculum ? `${state.curriculum.goal} · ${state.current_week}주차 ${state.current_day}일` : undefined}
      apiPath="/api/english"
      greeting={greeting}
      onSessionSaved={loadState}
      processContent={processContent}
      extraHeader={
        state?.weak_points && state.weak_points.length > 0 ? (
          <div className="hidden sm:flex items-center gap-2 text-xs text-[#555]">
            <span className="text-[#e8ff47]">약점</span>
            {state.weak_points.slice(-2).map((w, i) => (
              <span key={i} className="bg-[#1a1a1a] px-2 py-0.5 rounded">{w}</span>
            ))}
          </div>
        ) : undefined
      }
    />
  )
}
