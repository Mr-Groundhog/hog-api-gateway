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

import type { TFunction } from 'i18next'

import type { StatusBadgeProps } from '@/components/status-badge'

import {
  COOPERATION_STATUS,
  type CooperationMethodKey,
  type CooperationSiteTypeKey,
} from './types'

// ============================================================================
// Validation Constants（与后端 service.MaxCooperation* 上限保持一致）
// ============================================================================

export const COOPERATION_VALIDATION = {
  SITE_NAME_MAX_LENGTH: 50,
  SITE_URL_MAX_LENGTH: 200,
  DESCRIPTION_MAX_LENGTH: 500,
  AUDIENCE_MAX_LENGTH: 100,
  CONTACT_MAX_LENGTH: 100,
  NOTES_MAX_LENGTH: 500,
  REVIEW_NOTE_MAX_LENGTH: 500,
} as const

// ============================================================================
// Status Configuration
// ============================================================================

export const COOPERATION_STATUSES: Record<
  number,
  Pick<StatusBadgeProps, 'variant'> & { labelKey: string; value: number }
> = {
  [COOPERATION_STATUS.PENDING]: {
    labelKey: 'Pending Review',
    variant: 'warning',
    value: COOPERATION_STATUS.PENDING,
  },
  [COOPERATION_STATUS.APPROVED]: {
    labelKey: 'Approved',
    variant: 'success',
    value: COOPERATION_STATUS.APPROVED,
  },
  [COOPERATION_STATUS.REJECTED]: {
    labelKey: 'Rejected',
    variant: 'danger',
    value: COOPERATION_STATUS.REJECTED,
  },
}

export function getCooperationStatusOptions(t: TFunction) {
  return Object.values(COOPERATION_STATUSES).map((config) => ({
    label: t(config.labelKey),
    value: String(config.value),
  }))
}

// ============================================================================
// Method / Site Type Configuration（labelKey 是 i18n 键，组件中 t(config.labelKey)）
// ============================================================================

export const COOPERATION_METHODS: Record<
  CooperationMethodKey,
  { labelKey: string; value: CooperationMethodKey }
> = {
  token: { labelKey: 'Token Support', value: 'token' },
  invite: { labelKey: 'User Invitations', value: 'invite' },
  content: { labelKey: 'Content Creation', value: 'content' },
  link: { labelKey: 'Link Exchange', value: 'link' },
  community: { labelKey: 'Community Promotion', value: 'community' },
  tech: { labelKey: 'Technical Partnership', value: 'tech' },
  sponsor: { labelKey: 'Sponsorship', value: 'sponsor' },
  other: { labelKey: 'Other', value: 'other' },
}

export const COOPERATION_METHOD_KEYS = Object.keys(
  COOPERATION_METHODS
) as CooperationMethodKey[]

/**
 * 开放合作方式的运行时条目：内置方式沿用 labelKey 翻译，自定义方式（或管理员
 * 重命名的内置方式）带 label。label 与 labelKey 都缺省时展示 id 原文。
 */
export type CooperationMethodOption = {
  id: string
  /** 管理员自定义名称；空表示用内置 labelKey 的翻译 */
  label?: string
  /** 内置方式的 i18n 键；自定义方式没有 */
  labelKey?: string
}

// 与后端 setting 层上限保持一致（保证全选时 methods 列 JSON 不超列宽）
export const COOPERATION_METHOD_LIMITS = {
  MAX_METHODS: 10,
  MAX_ID_LENGTH: 16,
  MAX_LABEL_LENGTH: 50,
} as const

const DEFAULT_METHOD_OPTIONS: CooperationMethodOption[] =
  COOPERATION_METHOD_KEYS.map((key) => ({
    id: key,
    labelKey: COOPERATION_METHODS[key].labelKey,
  }))

/**
 * 解析管理端 CooperationMethodsAdmin 配置（/api/status 下发的 JSON 数组字符串）。
 * 元素支持字符串（内置 id，旧格式）或 {id,label} 对象（自定义 / 重命名）。
 * 与后端 setting.GetEnabledCooperationMethodIds 的回落保持一致：
 * 空 / 解析失败 / 过滤后为空时回落内置全集。
 */
export function getCooperationMethodOptions(
  raw: string | null | undefined
): CooperationMethodOption[] {
  if (!raw || raw.trim() === '') return DEFAULT_METHOD_OPTIONS
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return DEFAULT_METHOD_OPTIONS
    const options: CooperationMethodOption[] = []
    for (const entry of parsed) {
      let id = ''
      let label: string | undefined
      if (typeof entry === 'string') {
        id = entry.trim()
      } else if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>
        if (typeof record.id === 'string') id = record.id.trim()
        if (typeof record.label === 'string' && record.label.trim() !== '') {
          label = record.label.trim()
        }
      }
      if (id === '' || id.length > COOPERATION_METHOD_LIMITS.MAX_ID_LENGTH) {
        continue
      }
      if (options.some((option) => option.id === id)) continue
      const builtin = COOPERATION_METHODS[id as CooperationMethodKey]
      options.push(
        label !== undefined || !builtin
          ? { id, label }
          : { id, labelKey: builtin.labelKey }
      )
      if (options.length >= COOPERATION_METHOD_LIMITS.MAX_METHODS) break
    }
    return options.length > 0 ? options : DEFAULT_METHOD_OPTIONS
  } catch {
    return DEFAULT_METHOD_OPTIONS
  }
}

/**
 * 解析某个合作方式 id 的展示文案：自定义名 > 内置翻译 > id 原文。
 * 已被管理员删除的方式（历史申请数据）回落 id 原文，不隐藏。
 */
export function getCooperationMethodLabel(
  option: CooperationMethodOption | undefined,
  id: string,
  t: TFunction
): string {
  if (option?.label) return option.label
  if (option?.labelKey) return t(option.labelKey)
  const builtin = COOPERATION_METHODS[id as CooperationMethodKey]
  if (builtin) return t(builtin.labelKey)
  return id
}

export const COOPERATION_SITE_TYPES: Record<
  CooperationSiteTypeKey,
  { labelKey: string; value: CooperationSiteTypeKey }
> = {
  blog: { labelKey: 'Personal Blog', value: 'blog' },
  forum: { labelKey: 'Forum / Community', value: 'forum' },
  tool: { labelKey: 'Tool Site', value: 'tool' },
  channel: { labelKey: 'Video Channel', value: 'channel' },
  team: { labelKey: 'Dev Team', value: 'team' },
  open_source: { labelKey: 'Open Source Project', value: 'open_source' },
  relay: { labelKey: 'Relay Station', value: 'relay' },
  other: { labelKey: 'Other', value: 'other' },
}

export const COOPERATION_SITE_TYPE_KEYS = Object.keys(
  COOPERATION_SITE_TYPES
) as CooperationSiteTypeKey[]

export function getCooperationSiteTypeOptions(t: TFunction) {
  return Object.values(COOPERATION_SITE_TYPES).map((config) => ({
    label: t(config.labelKey),
    value: config.value,
  }))
}

/** 解析后端 methods 列（JSON 数组字符串）；损坏数据回落为空数组，不抛错。
 * 不过滤方式标识——自定义方式的合法性由配置决定，展示层对未知 id 回落原文。 */
export function parseCooperationMethods(methods: string): string[] {
  try {
    const parsed = JSON.parse(methods) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is string => typeof item === 'string' && item.trim() !== ''
    )
  } catch {
    return []
  }
}
