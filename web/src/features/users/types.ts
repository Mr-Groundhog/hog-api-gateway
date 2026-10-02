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
import { z } from 'zod'

import type { AdminPermissionMatrix } from '@/lib/admin-permissions'

// ============================================================================
// User Schema & Types
// ============================================================================

/** User status: 1 = enabled, 2 = disabled, 3+ = other states */
export const userStatusSchema = z.number()
export type UserStatus = z.infer<typeof userStatusSchema>

/** User role: 1 = common user, 10 = admin, 100 = root */
export const userRoleSchema = z.number()
export type UserRole = z.infer<typeof userRoleSchema>

export const userSchema = z.object({
  id: z.number(),
  username: z.string(),
  display_name: z.string(),
  password: z.string().optional(),
  github_id: z.string().optional(),
  oidc_id: z.string().optional(),
  wechat_id: z.string().optional(),
  telegram_id: z.string().optional(),
  email: z.string().optional(),
  quota: z.number(),
  used_quota: z.number(),
  request_count: z.number(),
  group: z.string(),
  aff_code: z.string().optional(),
  aff_count: z.number().optional(),
  aff_quota: z.number().optional(),
  aff_history_quota: z.number().optional(),
  inviter_id: z.number().optional(),
  linux_do_id: z.string().optional(),
  registration_source: z.number().optional(),
  status: userStatusSchema,
  ban_reason: z.string().optional(),
  role: userRoleSchema,
  created_at: z.number().optional(),
  updated_at: z.number().optional(),
  last_login_at: z.number().optional(),
  last_login_ip: z.string().optional(),
  DeletedAt: z.any().nullable().optional(),
  remark: z.string().optional(),
  admin_permissions: z
    .record(z.string(), z.record(z.string(), z.boolean()))
    .optional(),
})
export type User = z.infer<typeof userSchema>

export const userListSchema = z.array(userSchema)

// ============================================================================
// API Request/Response Types
// ============================================================================

/** Generic API response */
export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export type UserSortBy =
  | 'id'
  | 'username'
  | 'quota'
  | 'group'
  | 'created_at'
  | 'last_login_at'

export type UserSortOrder = 'asc' | 'desc'

export interface GetUsersParams {
  p?: number
  page_size?: number
  sort_by?: UserSortBy
  sort_order?: UserSortOrder
}

export interface GetUsersResponse {
  success: boolean
  message?: string
  data?: {
    items: User[]
    total: number
    page: number
    page_size: number
  }
}

export interface SearchUsersParams {
  keyword?: string
  group?: string
  role?: string
  status?: string
  p?: number
  page_size?: number
  sort_by?: UserSortBy
  sort_order?: UserSortOrder
}

export interface UserFormData {
  username: string
  display_name: string
  password?: string
  role?: number // Only used when creating user
  quota?: number // Only used when updating user
  group?: string // Only used when updating user
  remark?: string // Only used when updating user
  admin_permissions?: AdminPermissionMatrix
}

export type ManageUserAction =
  | 'promote'
  | 'demote'
  | 'enable'
  | 'disable'
  | 'delete'
  | 'add_quota'

export type QuotaAdjustMode = 'add' | 'subtract' | 'override'

export interface ManageUserQuotaPayload {
  id: number
  action: 'add_quota'
  mode: QuotaAdjustMode
  value: number
}

export interface ManageUserPayload {
  id: number
  action: ManageUserAction
  ban_reason?: string
}

/** 条件批量封禁的依据字段：按上次登录时间或按最近一次 API 调用时间 */
export type BanByConditionMode = 'last_login' | 'last_call'

export interface BanByConditionRequest {
  /** 封禁依据的字段 */
  mode: BanByConditionMode
  /** Unix 秒时间戳；对应时间早于该时间的用户将被封禁 */
  before: number
}

export interface BanByConditionResponse {
  success: boolean
  message?: string
  banned?: number
}

/** 筛选预览请求：last_login_before 与 last_call_before 同时提供时为 AND 条件 */
export interface UserFilterRequest {
  /** Unix 秒；上次登录时间早于该值的用户 */
  last_login_before?: number
  /** Unix 秒；最近消费调用时间早于该值（或无调用记录）的用户 */
  last_call_before?: number
  page?: number
  page_size?: number
  /** 只返回 ID 列表（自带 1000 上限），用于「选择全部结果」 */
  ids_only?: boolean
}

/** 筛选预览的用户 DTO（后端显式字段，不含敏感信息） */
export interface UserFilterItem {
  id: number
  username: string
  display_name: string
  role: number
  status: number
  quota: number
  used_quota: number
  group: string
  last_login_at: number
  /** 仅在筛选条件包含「最近 API 调用时间」时返回 */
  last_call_at?: number
}

export interface UserFilterResponse {
  items?: UserFilterItem[]
  ids?: number[]
  total: number
  page?: number
  page_size?: number
  /** ids_only 命中数超过 1000 时为 true */
  truncated?: boolean
}

/** 批量操作中单个用户的失败结果；reason 为稳定标识，由前端本地化展示 */
export interface UserBatchFailure {
  id: number
  reason: string
}

export interface BatchBanByIdsRequest {
  ids: number[]
  ban_reason?: string
}

export interface BatchBanByIdsResponse {
  banned: number
  failed: UserBatchFailure[]
}

export type BatchQuotaDirection = 'add' | 'subtract'
export type BatchQuotaMode = 'ratio' | 'fixed'

export interface BatchQuotaRequest {
  ids: number[]
  direction: BatchQuotaDirection
  mode: BatchQuotaMode
  /** mode=ratio 时必填：变动量 = |当前额度| × ratio */
  ratio?: number
  /** mode=fixed 时必填：每个用户的变动量（quota 整数） */
  value?: number
}

export interface BatchQuotaResponse {
  succeeded: number
  failed: UserBatchFailure[]
}

// ============================================================================
// Dialog Types
// ============================================================================

export type UsersDialogType =
  | 'create'
  | 'update'
  | 'delete'
  | 'detail'
  | 'ban_by_condition'
  | 'filter_users'
