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

export interface SensitiveWordViolationUser {
  user_id: number
  username: string
  violation_count: number
  trigger_count: number
  highlighted: boolean
  latest_created_at: number
}

export interface SensitiveWordViolationUserPage {
  page: number
  page_size: number
  total: number
  items: SensitiveWordViolationUser[]
}

export interface SensitiveWordViolationFilters {
  user?: string
  user_id?: number
  keyword?: string
  start_time?: number
  end_time?: number
  highlighted?: boolean
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


export async function getSensitiveWordViolationUsers(
  page: number,
  pageSize: number,
  filters: SensitiveWordViolationFilters = {}
) {
  const res = await api.get<{ data: SensitiveWordViolationUserPage }>(
    '/api/sensitive-word-violations/users',
    { params: { p: page, page_size: pageSize, ...filters } }
  )
  return res.data.data
}

export async function deleteSensitiveWordViolations(input: { ids: number[]; days?: number; beforeTime?: number }) {
  const res = await api.post<{
    data: { deleted: number }
  }>('/api/sensitive-word-violations/delete', {
    ids: input.ids,
    ...(input.days !== undefined ? { days: input.days } : {}),
    ...(input.beforeTime !== undefined ? { before_time: input.beforeTime } : {}),
  })
  return res.data.data
}

export async function banSensitiveWordViolationUser(userId: number) {
  return api.post('/api/sensitive-word-violations/ban', { user_id: userId })
}

export async function resetSensitiveWordViolationCount(userId: number) {
  return api.post('/api/sensitive-word-violations/reset-count', {
    user_id: userId,
  })
}
