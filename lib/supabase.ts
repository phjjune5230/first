import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const STATE_ID = '00000000-0000-0000-0000-000000000001'

export type DailyLog = {
  date: string
  summary: string
  notes: string
  weak_points: string[]
}

export type Curriculum = {
  goal: string
  level: string
  duration: string
  weekly_plan: string[]
}

export type StudyState = {
  id: string
  curriculum: Curriculum | null
  current_week: number
  current_day: number
  daily_logs: DailyLog[]
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

export async function appendDailyLog(log: DailyLog) {
  const state = await getState()
  if (!state) return

  const logs = [...(state.daily_logs || []), log]
  // 최근 30일만 유지
  const trimmed = logs.slice(-30)

  // 약점 누적 (중복 제거)
  const allWeakPoints = Array.from(
    new Set([...(state.weak_points || []), ...log.weak_points])
  ).slice(-20)

  await updateState({ daily_logs: trimmed, weak_points: allWeakPoints })
}
