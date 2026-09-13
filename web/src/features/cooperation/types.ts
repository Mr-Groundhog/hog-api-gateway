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

// 后端下发数值枚举（见 model/cooperation.go），前端只负责渲染，不重复实现状态规则。
export const COOPERATION_STATUS = {
  PENDING: 1,
  APPROVED: 2,
  REJECTED: 3,
} as const

// 合作方式标识，与后端 service.cooperationMethodKeys 白名单保持同一份取值
export type CooperationMethodKey =
  | 'token'
  | 'invite'
  | 'content'
  | 'link'
  | 'community'
  | 'tech'
  | 'sponsor'
  | 'other'

// 站点类型标识，与后端 service.cooperationSiteTypeKeys 白名单保持同一份取值
export type CooperationSiteTypeKey =
  | 'blog'
  | 'forum'
  | 'tool'
  | 'channel'
  | 'team'
  | 'open_source'
  | 'relay'
  | 'other'

// 与后端 model.CooperationApplication 的 JSON 形状一致（snake_case）
export type CooperationApplication = {
  id: number
  user_id: number
  username: string
  site_name: string
  site_url: string
  site_banner: string
  site_type: string
  description: string
  audience: string
  methods: string
  contact: string
  notes: string
  status: number
  review_note: string
  reviewer_id: number
  review_time: number
  created_time: number
  updated_time: number
}

export type CooperationStats = {
  pending: number
  approved: number
  rejected: number
  total: number
}

// 后端分页统一返回 common.PageInfo 的 JSON 形状
export type CooperationItemsPage = {
  items: CooperationApplication[]
  total: number
  page: number
  page_size: number
}

export type CooperationApiResponse<T> = {
  success: boolean
  data?: T
  message?: string
}

export type CreateCooperationPayload = {
  site_name: string
  site_url: string
  site_banner: string
  site_type: string
  description: string
  audience: string
  methods: string[]
  contact: string
  notes: string
}

export type ReviewCooperationAction = 'approve' | 'reject'

// 与后端 model.CooperationSite 的 JSON 形状一致（snake_case）。
// 合作站点展示条目：featured 优先展示，其余按 sort 升序卡片展示。
export type CooperationSiteEntry = {
  id: number
  name: string
  url: string
  logo: string
  banner: string
  site_type: string
  description: string
  featured: boolean
  sort: number
  enabled: boolean
  created_time: number
  updated_time: number
}

// 管理端创建 / 更新合作站点的请求体
export type SaveCooperationSitePayload = {
  id?: number
  name: string
  url: string
  logo: string
  banner: string
  site_type: string
  description: string
  featured: boolean
  sort: number
  enabled: boolean
}
