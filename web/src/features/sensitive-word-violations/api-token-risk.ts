/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { api } from '@/lib/api'

export type TokenRiskEventType =
  | 'concurrent_fp'
  | 'single_fp_concurrency'
  | 'fp_burst'
  | 'fp_cross_user'

export interface TokenRiskEvent {
  id: number
  user_id: number
  token_id: number
  event_type: TokenRiskEventType
  hour_bucket: number
  evidence: string
  status: number
  created_time: number
}

export interface TokenRiskEventPage {
  page: number
  page_size: number
  total: number
  items: TokenRiskEvent[]
}

type TokenRiskEventPageResponse = Omit<TokenRiskEventPage, 'items'> & {
  items: TokenRiskEvent[] | null
}

export interface TokenRiskFilters {
  status?: number
  event_type?: TokenRiskEventType
  user_id?: number
  token_id?: number
}

export interface TokenRiskUserSignal {
  event_type: TokenRiskEventType
  evidence: string
  created_time: number
}

export interface TokenRiskUserSummary {
  user_id: number
  username: string
  event_count: number
  concurrent_fp_count: number
  single_fp_count: number
  fp_burst_count: number
  fp_cross_user_count: number
  pending_count: number
  involved_token_count: number
  latest_event_time: number
  latest_event_type: TokenRiskEventType
  latest_evidence: string
  signals: TokenRiskUserSignal[]
}

export interface TokenRiskUserPage {
  page: number
  page_size: number
  total: number
  items: TokenRiskUserSummary[]
}

/** 后端对空切片返回 null，响应类型如实标注后再在请求层归一化。 */
type TokenRiskUserSummaryResponse = Omit<TokenRiskUserSummary, 'signals'> & {
  signals: TokenRiskUserSignal[] | null
}

type TokenRiskUserPageResponse = Omit<TokenRiskUserPage, 'items'> & {
  items: TokenRiskUserSummaryResponse[] | null
}

export async function getTokenRiskUsers(
  page: number,
  pageSize: number,
  filters: TokenRiskFilters = {}
) {
  const res = await api.get<{ data: TokenRiskUserPageResponse }>(
    '/api/token-risk/users',
    { params: { p: page, page_size: pageSize, ...filters } }
  )
  return {
    ...res.data.data,
    items: (res.data.data.items ?? []).map((item) => ({
      ...item,
      signals: item.signals ?? [],
    })),
  }
}

export async function banTokenRiskUser(userId: number) {
  return api.post('/api/token-risk/ban', { user_id: userId })
}

export async function deleteTokenRiskEvents(userIds: number[]) {
  const res = await api.post<{
    data: { deleted: number }
  }>('/api/token-risk/delete', { user_ids: userIds })
  return res.data.data
}

export async function getTokenRiskEvents(
  page: number,
  pageSize: number,
  filters: TokenRiskFilters = {}
) {
  const res = await api.get<{ data: TokenRiskEventPageResponse }>(
    '/api/token-risk/events',
    { params: { p: page, page_size: pageSize, ...filters } }
  )
  return {
    ...res.data.data,
    items: res.data.data.items ?? [],
  }
}

export async function updateTokenRiskEventStatus(id: number, status: number) {
  return api.put(`/api/token-risk/events/${id}/status`, { status })
}
