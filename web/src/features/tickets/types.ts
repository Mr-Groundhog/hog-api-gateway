/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

// 后端下发数值枚举（见 model/ticket.go），前端只负责渲染，不重复实现状态规则。
export const TICKET_TYPE = {
  API_CALL: 1,
  ACCOUNT: 2,
  BILLING: 3,
  OTHER: 4,
} as const

export const TICKET_STATUS = {
  PENDING: 1,
  REPLIED: 2,
  CLOSED: 3,
} as const

export const TICKET_AUTHOR_ROLE = {
  USER: 1,
  ADMIN: 2,
} as const

export type TicketListItem = {
  id: number
  userId: number
  username: string
  type: number
  title: string
  status: number
  messageCount: number
  unreadReply: boolean
  lastReplyTime: number
  createdTime: number
}

export type TicketMessage = {
  id: number
  authorRole: number
  username: string
  content: string
  createdTime: number
}

export type TicketDetail = TicketListItem & {
  messages: TicketMessage[]
  canReply: boolean
  canClose: boolean
}

export type TicketStats = {
  pending: number
  replied: number
  closed: number
  total: number
}

// 后端分页统一返回 common.PageInfo 的 JSON 形状
export type TicketListData = {
  items: TicketListItem[]
  total: number
  page: number
  page_size: number
}

export type TicketApiResponse<T> = {
  success: boolean
  data?: T
  message?: string
}

export type CreateTicketPayload = {
  type: number
  title: string
  content: string
}

// 管理端筛选条件；空字符串表示不过滤
export type AdminTicketFilters = {
  status: string
  type: string
  keyword: string
  user: string
  startTime?: number
  endTime?: number
}
