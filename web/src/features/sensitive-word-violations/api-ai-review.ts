/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { api } from '@/lib/api'

export type AIReviewSource = 'sampled' | 'sensitive_hit'
export type AIReviewVerdict = 'flagged' | 'safe' | 'error'
export type AIReviewAdminStatus = 0 | 1 | 2 | 3
export type AIReviewActionTaken = 'none' | 'warned' | 'banned'

export interface AIReviewRecord {
  id: number
  user_id: number
  username: string
  token_id: number
  token_name: string
  ip: string
  user_agent: string
  request_path: string
  group_name: string
  model_name: string
  request_id: string
  source: AIReviewSource
  matched_words: string
  request_excerpt: string
  verdict: AIReviewVerdict
  category: string
  confidence: number
  reason: string
  review_response: string
  admin_status: AIReviewAdminStatus
  admin_id: number
  admin_username: string
  admin_comment: string
  action_taken: AIReviewActionTaken
  handled_at: number
  created_at: number
}

export interface AIReviewRecordPage {
  page: number
  page_size: number
  total: number
  items: AIReviewRecord[]
}

type AIReviewRecordPageResponse = Omit<AIReviewRecordPage, 'items'> & {
  items: AIReviewRecord[] | null
}

export interface AIReviewFilters {
  user?: string
  verdict?: AIReviewVerdict
  source?: AIReviewSource
  admin_status?: AIReviewAdminStatus
  start_time?: number
  end_time?: number
}

export interface AIReviewStats {
  counts: Record<string, number>
  queue_length: number
  dropped_total: number
  processed_total: number
  flagged_total: number
  auto_banned_total: number
}

export async function getAIReviewRecords(
  page: number,
  pageSize: number,
  filters: AIReviewFilters = {}
) {
  const res = await api.get<{ data: AIReviewRecordPageResponse }>(
    '/api/ai-review',
    { params: { p: page, page_size: pageSize, ...filters } }
  )
  return {
    ...res.data.data,
    items: res.data.data.items ?? [],
  }
}

export async function getAIReviewStats() {
  const res = await api.get<{ data: AIReviewStats }>('/api/ai-review/stats')
  return res.data.data
}

export type AIReviewHandleAction = 'confirm' | 'dismiss' | 'warn' | 'ban'

export async function handleAIReviewRecord(input: {
  id: number
  action: AIReviewHandleAction
  comment?: string
}) {
  return api.post('/api/ai-review/handle', input)
}

export async function deleteAIReviewRecords(input: {
  ids?: number[]
  days?: number
  beforeTime?: number
}) {
  const res = await api.post<{
    data: { deleted: number }
  }>('/api/ai-review/delete', {
    ids: input.ids ?? [],
    ...(input.days !== undefined ? { days: input.days } : {}),
    ...(input.beforeTime !== undefined
      ? { before_time: input.beforeTime }
      : {}),
  })
  return res.data.data
}
