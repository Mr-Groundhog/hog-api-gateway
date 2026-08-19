import { api } from '@/lib/api'

export type UserRanking = {
  user_id: number
  username: string
  ip_count: number
  ips: string[]
  recent_ip_count: number
  today_api_calls: number
}

export type UserRankingPage = {
  page: number
  page_size: number
  total: number
  items: UserRanking[]
}

export async function getUserRankings(page: number, pageSize: number) {
  const response = await api.get<{ data: UserRankingPage }>(
    '/api/log/user-rankings',
    { params: { p: page, page_size: pageSize } }
  )
  return response.data.data
}
