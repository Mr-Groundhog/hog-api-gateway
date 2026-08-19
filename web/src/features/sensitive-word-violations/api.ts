import { api } from '@/lib/api'

export interface SensitiveWordViolation {
  id: number
  user_id: number
  username: string
  ip: string
  user_agent: string
  request_path: string
  request_content: string
  matched_words: string
  match_locations: string
  trigger_count: number
  highlighted: boolean
  created_at: number
}

export interface SensitiveWordViolationPage {
  page: number
  page_size: number
  total: number
  items: SensitiveWordViolation[]
}

export interface SensitiveWordViolationFilters {
  user?: string
  start_time?: number
  end_time?: number
}

export async function getSensitiveWordViolations(
  page: number,
  pageSize: number,
  filters: SensitiveWordViolationFilters = {}
) {
  const res = await api.get<{ data: SensitiveWordViolationPage }>(
    '/api/sensitive-word-violations',
    { params: { p: page, page_size: pageSize, ...filters } }
  )
  return res.data.data
}

export async function banSensitiveWordViolationUser(userId: number) {
  return api.post('/api/sensitive-word-violations/ban', { user_id: userId })
}
