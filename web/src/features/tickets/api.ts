/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { api } from '@/lib/api'

import type {
  AdminTicketFilters,
  CreateTicketPayload,
  TicketApiResponse,
  TicketDetail,
  TicketListData,
  TicketStats,
} from './types'

export const ticketQueryKeys = {
  list: ['tickets', 'list'] as const,
  unread: ['tickets', 'unread'] as const,
  adminList: ['tickets', 'adminList'] as const,
  adminStats: ['tickets', 'adminStats'] as const,
  detail: (id: number) => ['tickets', 'detail', id] as const,
}

function requireData<T>(response: TicketApiResponse<T>, fallback: string): T {
  if (!response.success || response.data === undefined) {
    throw new Error(response.message || fallback)
  }
  return response.data
}

// ============================================================================
// User side
// ============================================================================

export type SelfTicketListParams = {
  page: number
  pageSize: number
  status?: string
  type?: string
}

export async function getSelfTickets(
  params: SelfTicketListParams
): Promise<TicketListData> {
  const response = await api.get<TicketApiResponse<TicketListData>>(
    '/api/ticket/self',
    { params, skipErrorHandler: true }
  )
  return requireData(response.data, 'Failed to load tickets')
}

export async function getSelfTicketUnread(): Promise<number> {
  const response = await api.get<TicketApiResponse<number>>(
    '/api/ticket/self/unread',
    { skipErrorHandler: true }
  )
  return requireData(response.data, 'Failed to load tickets')
}

export async function getSelfTicketDetail(id: number): Promise<TicketDetail> {
  const response = await api.get<TicketApiResponse<TicketDetail>>(
    `/api/ticket/self/${id}`,
    { skipErrorHandler: true }
  )
  return requireData(response.data, 'Failed to load tickets')
}

export async function createTicket(
  payload: CreateTicketPayload
): Promise<TicketDetail> {
  const response = await api.post<TicketApiResponse<TicketDetail>>(
    '/api/ticket/',
    payload,
    { skipErrorHandler: true }
  )
  return requireData(response.data, 'Failed to submit ticket')
}

export async function replySelfTicket(
  id: number,
  content: string
): Promise<void> {
  const response = await api.post<TicketApiResponse<null>>(
    `/api/ticket/self/${id}/reply`,
    { content },
    { skipErrorHandler: true }
  )
  requireData(response.data, 'Failed to submit reply')
}

export async function closeSelfTicket(id: number): Promise<void> {
  const response = await api.post<TicketApiResponse<null>>(
    `/api/ticket/self/${id}/close`,
    {},
    { skipErrorHandler: true }
  )
  requireData(response.data, 'Failed to close ticket')
}

// ============================================================================
// Admin side
// ============================================================================

export type AdminTicketListParams = {
  page: number
  pageSize: number
  status?: string
  type?: string
  keyword?: string
  user?: string
  start_time?: number
  end_time?: number
}

export async function getAdminTickets(
  params: AdminTicketListParams
): Promise<TicketListData> {
  const response = await api.get<TicketApiResponse<TicketListData>>(
    '/api/ticket/admin',
    { params, skipErrorHandler: true }
  )
  return requireData(response.data, 'Failed to load tickets')
}

export async function getAdminTicketStats(): Promise<TicketStats> {
  const response = await api.get<TicketApiResponse<TicketStats>>(
    '/api/ticket/admin/stats',
    { skipErrorHandler: true }
  )
  return requireData(response.data, 'Failed to load tickets')
}

export async function getAdminTicketDetail(id: number): Promise<TicketDetail> {
  const response = await api.get<TicketApiResponse<TicketDetail>>(
    `/api/ticket/admin/${id}`,
    { skipErrorHandler: true }
  )
  return requireData(response.data, 'Failed to load tickets')
}

export async function replyAdminTicket(
  id: number,
  content: string
): Promise<void> {
  const response = await api.post<TicketApiResponse<null>>(
    `/api/ticket/admin/${id}/reply`,
    { content },
    { skipErrorHandler: true }
  )
  requireData(response.data, 'Failed to submit reply')
}

export async function updateAdminTicketStatus(
  id: number,
  status: number
): Promise<void> {
  const response = await api.put<TicketApiResponse<null>>(
    `/api/ticket/admin/${id}/status`,
    { status },
    { skipErrorHandler: true }
  )
  requireData(response.data, 'Failed to update ticket status')
}

export async function deleteAdminTicket(id: number): Promise<void> {
  const response = await api.delete<TicketApiResponse<null>>(
    `/api/ticket/admin/${id}`,
    { skipErrorHandler: true }
  )
  requireData(response.data, 'Failed to delete ticket')
}

// 供管理端筛选栏组装查询参数；空字符串字段不发送
export function buildAdminTicketParams(
  filters: AdminTicketFilters,
  page: number,
  pageSize: number
): AdminTicketListParams {
  const params: AdminTicketListParams = { page, pageSize }
  if (filters.status) params.status = filters.status
  if (filters.type) params.type = filters.type
  if (filters.keyword) params.keyword = filters.keyword
  if (filters.user) params.user = filters.user
  if (filters.startTime) params.start_time = filters.startTime
  if (filters.endTime) params.end_time = filters.endTime
  return params
}
