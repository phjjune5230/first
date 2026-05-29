import { supabase } from './supabase'

export type GoalStatus = '진행중' | '완료' | '미완료' | '검토예정'

export type Goal = {
  id: number
  category: string
  subcategory: string
  description: string
  due_date: string
  status: GoalStatus
  created_at: string
  updated_at: string
}

export async function getGoals(): Promise<Goal[]> {
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) { console.error('getGoals error:', error); return [] }
  return data || []
}

export async function addGoal(goal: Omit<Goal, 'id' | 'created_at' | 'updated_at'>) {
  const { error } = await supabase.from('goals').insert(goal)
  if (error) console.error('addGoal error:', error)
}

export async function updateGoal(id: number, updates: Partial<Goal>) {
  const { error } = await supabase
    .from('goals')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) console.error('updateGoal error:', error)
}
