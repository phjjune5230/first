'use client'

import { useState, useEffect } from 'react'
import ChatWindow from '@/components/ChatWindow'
import { getState, updateState, StudyState } from '@/lib/supabase'

export default function EnglishPage() {
  const [state, setState] = useState<StudyState | null>(null)
  const [greeting, setGreeting] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [editWeek, setEditWeek] = useState(1)
  const [editDay, setEditDay] = useState(1)

  useEffect(() => {
    loadState()
  }, [])

  async function loadState() {
    const s = await getState()
    setState(s)
    if (s) {
      setEditWeek(s.current_week)
      setEditDay(s.current_day)
    }
    setGreeting(
      s?.curriculum
        ? `안녕하세요! ${s.current_week}주차 ${s.current_day}일 학습 시작할까요?`
        : '안녕하세요! 영어 공부 비서예요. 커리큘럼부터 같이 만들어봐요!'
    )
  }

  async function handleSaveSchedule() {
    await updateState({ current_week: editWeek, current_day: editDay })
    setState((prev) => prev ? { ...prev, current_week: editWeek, current_day: editDay } : prev)
    setEditMode(false)
    loadState()
  }

  function processContent(content: string) {
    return content.replace('[CURRICULUM_READY]', '').replace(/\{[\s\S]*\}/, '').trim()
  }

  if (!greeting) return null

  return (
    <>
      <ChatWindow
        title="영어 공부"
        subtitle={state?.curriculum ? `${state.curriculum.goal} · ${state.current_week}주차 ${state.current_day}일` : undefined}
        apiPath="/api/english"
        greeting={greeting}
        onSessionSaved={loadState}
        processContent={processContent}
        showLanguageSelector={true}
        extraHeader={
          <div className="flex items-center gap-3">
            {state?.weak_points && state.weak_points.length > 0 && (
              <div className="hidden sm:flex items-center gap-2 text-xs text-[#555]">
                <span className="text-[#e8ff47]">약점</span>
                {state.weak_points.slice(-2).map((w, i) => (
                  <span key={i} className="bg-[#1a1a1a] px-2 py-0.5 rounded">{w}</span>
                ))}
              </div>
            )}
            <button
              onClick={() => setEditMode(!editMode)}
              className="text-xs border border-[#333] px-3 py-1.5 rounded hover:border-[#e8ff47] hover:text-[#e8ff47] transition-colors"
            >
              {editMode ? '닫기' : '일정수정'}
            </button>
          </div>
        }
      />

      {editMode && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#0a0a0a] border-t border-[#222] p-4 z-50">
          <div className="max-w-2xl mx-auto flex items-end gap-3">
            <div className="flex-1 flex gap-2 items-end">
              <div>
                <label className="text-xs text-[#555]">주차</label>
                <input
                  type="number"
                  min="1"
                  value={editWeek}
                  onChange={(e) => setEditWeek(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-20 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#e8ff47]"
                />
              </div>
              <div>
                <label className="text-xs text-[#555]">일차</label>
                <input
                  type="number"
                  min="1"
                  value={editDay}
                  onChange={(e) => setEditDay(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-20 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#e8ff47]"
                />
              </div>
            </div>
            <button
              onClick={handleSaveSchedule}
              className="bg-[#e8ff47] text-black text-xs font-bold px-4 py-1.5 rounded hover:bg-white transition-colors h-[32px]"
            >
              저장
            </button>
          </div>
        </div>
      )}
    </>
  )
}
