import { api } from '@/lib/api'

export type UserRanking = {
  user_id: number
  username: string
  ip_count: number
  ips: string[]
  ten_minute_ip_count: number
  api_calls: number
}

export type UserRankingPage = {
  total: number
  items: UserRanking[]
}

export type UserRankingPeriod = 'today' | '3days'

function normalizeCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export async function getUserRankings(period: UserRankingPeriod) {
  const response = await api.get<{ data: UserRankingPage }>(
    '/api/log/user-rankings',
    { params: { period } }
  )
  const data = response.data.data
  return {
    ...data,
    items: (data?.items ?? []).map((item) => ({
      ...item,
      ip_count: normalizeCount(item.ip_count),
      ips: Array.isArray(item.ips) ? item.ips : [],
      ten_minute_ip_count: normalizeCount(item.ten_minute_ip_count),
      api_calls: normalizeCount(item.api_calls),
    })),
  }
}
