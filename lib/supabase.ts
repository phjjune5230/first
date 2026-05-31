import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const STATE_ID = '00000000-0000-0000-0000-000000000001'

export type DailyStudy = {
  date: string
  summary: string
  notes: string
  weak_points: string[]
  learned_expressions: string[]  // 오늘 배운 표현 목록
}

export type StudyState = {
  id: string
  goal: string | null                      // 최종 목표
  plan: string | null                      // 목표 달성 방법/과정 (매 세션 업데이트)
  current_week: number
  current_day: number
  daily_studies: DailyStudy[]             // 날짜별 학습 내용
  learned_expressions: string[]           // 누적 학습 표현
  weak_points: string[]
}

export async function getState(): Promise<StudyState | null> {
  const { data, error } = await supabase
    .from('study_state')
    .select('*')
    .eq('id', STATE_ID)
    .single()

  if (error) {
    console.error('getState error:', error)
    return null
  }
  return data
}

export async function updateState(updates: Partial<StudyState>) {
  const { error } = await supabase
    .from('study_state')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', STATE_ID)

  if (error) console.error('updateState error:', error)
}

export async function appendDailyStudy(study: DailyStudy) {
  const state = await getState()
  if (!state) return

  // 최근 30일만 유지
  const studies = [...(state.daily_studies || []), study].slice(-30)

  // 학습 표현 누적 (중복 제거)
  const allExpressions = Array.from(
    new Set([...(state.learned_expressions || []), ...study.learned_expressions])
  )

  // 약점 누적 (중복 제거, 최근 20개)
  const allWeakPoints = Array.from(
    new Set([...(state.weak_points || []), ...study.weak_points])
  ).slice(-20)

  await updateState({
    daily_studies: studies,
    learned_expressions: allExpressions,
    weak_points: allWeakPoints,
  })
}