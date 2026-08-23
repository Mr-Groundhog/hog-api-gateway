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

type SensitiveWordViolationPageResponse = Omit<
  SensitiveWordViolationPage,
  'items'
> & {
  items: SensitiveWordViolation[] | null
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

type SensitiveWordViolationUserPageResponse = Omit<
  SensitiveWordViolationUserPage,
  'items'
> & {
  items: SensitiveWordViolationUser[] | null
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
  const res = await api.get<{ data: SensitiveWordViolationPageResponse }>(
    '/api/sensitive-word-violations',
    { params: { p: page, page_size: pageSize, ...filters } }
  )
  return {
    ...res.data.data,
    items: res.data.data.items ?? [],
  }
}


export async function getSensitiveWordViolationUsers(
  page: number,
  pageSize: number,
  filters: SensitiveWordViolationFilters = {}
) {
  const res = await api.get<{ data: SensitiveWordViolationUserPageResponse }>(
    '/api/sensitive-word-violations/users',
    { params: { p: page, page_size: pageSize, ...filters } }
  )
  return {
    ...res.data.data,
    items: res.data.data.items ?? [],
  }
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

export type ProbeGuardAction = 'warning' | 'banned' | 'dry_run'

export interface ProbeGuardLog {
  id: number
  user_id: number
  username: string
  token_id: number
  token_name: string
  ip: string
  user_agent: string
  window_seconds: number
  models_tested: string
  distinct_count: number
  trigger_count: number
  action_taken: ProbeGuardAction
  created_at: number
}

export interface ProbeGuardLogPage {
  page: number
  page_size: number
  total: number
  items: ProbeGuardLog[]
}

type ProbeGuardLogPageResponse = Omit<ProbeGuardLogPage, 'items'> & {
  items: ProbeGuardLog[] | null
}

export interface ProbeGuardLogUser {
  user_id: number
  username: string
  record_count: number
  dry_run_count: number
  trigger_count: number
  max_distinct: number
  /** 最近一条触发记录测试的模型清单（JSON 数组字符串） */
  latest_models?: string
  /** 最近一条触发记录的去重模型数 */
  latest_distinct?: number
  /** 最近一条触发记录的客户端 IP */
  latest_ip?: string
  latest_created_at: number
}

export interface ProbeGuardLogUserPage {
  page: number
  page_size: number
  total: number
  items: ProbeGuardLogUser[]
}

type ProbeGuardLogUserPageResponse = Omit<ProbeGuardLogUserPage, 'items'> & {
  items: ProbeGuardLogUser[] | null
}

export interface ProbeGuardFilters {
  user?: string
  user_id?: number
  ip?: string
  keyword?: string
  action?: ProbeGuardAction
  start_time?: number
  end_time?: number
}

export async function getProbeGuardLogs(
  page: number,
  pageSize: number,
  filters: ProbeGuardFilters = {}
) {
  const res = await api.get<{ data: ProbeGuardLogPageResponse }>(
    '/api/probe-guard/logs',
    { params: { p: page, page_size: pageSize, ...filters } }
  )
  return {
    ...res.data.data,
    items: res.data.data.items ?? [],
  }
}

export async function getProbeGuardLogUsers(
  page: number,
  pageSize: number,
  filters: ProbeGuardFilters = {}
) {
  const res = await api.get<{ data: ProbeGuardLogUserPageResponse }>(
    '/api/probe-guard/users',
    { params: { p: page, page_size: pageSize, ...filters } }
  )
  return {
    ...res.data.data,
    items: res.data.data.items ?? [],
  }
}

export async function deleteProbeGuardLogs(input: {
  ids?: number[]
  days?: number
  beforeTime?: number
  action?: ProbeGuardAction
}) {
  const res = await api.post<{
    data: { deleted: number }
  }>('/api/probe-guard/delete', {
    ids: input.ids ?? [],
    ...(input.days !== undefined ? { days: input.days } : {}),
    ...(input.beforeTime !== undefined ? { before_time: input.beforeTime } : {}),
    ...(input.action !== undefined ? { action: input.action } : {}),
  })
  return res.data.data
}

export async function banProbeGuardUser(userId: number) {
  return api.post('/api/probe-guard/ban', { user_id: userId })
}

export async function resetProbeGuardCount(userId: number) {
  return api.post('/api/probe-guard/reset-count', {
    user_id: userId,
  })
}
