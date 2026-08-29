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
import { Shield, User, Users } from 'lucide-react'

import type { User as UserType } from './types'

// ============================================================================
// User Utilities
// ============================================================================

export const isUserDeleted = (user: UserType): boolean => {
  return user.DeletedAt != null
}

// ============================================================================
// User Status Configuration
// ============================================================================

export const USER_STATUS = {
  ENABLED: 1,
  DISABLED: 2,
  DELETED: -1,
} as const

export const USER_BAN_REASONS = {
  BATCH_ACTIVITY_CHECK: 'batch_activity_check',
  BATCH_INVITE_SUBACCOUNTS: 'batch_invite_subaccounts',
  PROHIBITED_WORDS: 'prohibited_words',
  JAILBREAK: 'jailbreak_or_prohibited_content',
  CUSTOM: 'custom',
} as const

export const USER_BAN_REASON_OPTIONS = [
  {
    value: USER_BAN_REASONS.BATCH_ACTIVITY_CHECK,
    labelKey: 'Batch activity checking',
  },
  {
    value: USER_BAN_REASONS.BATCH_INVITE_SUBACCOUNTS,
    labelKey: 'Batch inviting secondary accounts',
  },
  {
    value: USER_BAN_REASONS.PROHIBITED_WORDS,
    labelKey: 'Triggered prohibited words',
  },
  {
    value: USER_BAN_REASONS.JAILBREAK,
    labelKey: 'Jailbreak or prohibited information',
  },
] as const

/** Map a stored ban reason value (machine string) back to its i18n label key. */
export const USER_BAN_REASON_LABEL_KEYS: Record<string, string> = {
  ...Object.fromEntries(
    USER_BAN_REASON_OPTIONS.map((option) => [option.value, option.labelKey])
  ),
  // batch_model_probing 与「批量测活」含义一致，复用同一文案
  batch_model_probing: 'Batch activity checking',
  // inactive_15_days_no_api_calls 无对应下拉选项，按自定义原因直接展示中文
  inactive_15_days_no_api_calls: '规定时间内无api调用记录',
}

export const USER_STATUSES = {
  [USER_STATUS.ENABLED]: {
    labelKey: 'Enabled',
    variant: 'success' as const,
    value: USER_STATUS.ENABLED,
  },
  [USER_STATUS.DISABLED]: {
    labelKey: 'Disabled',
    variant: 'neutral' as const,
    value: USER_STATUS.DISABLED,
  },
  [USER_STATUS.DELETED]: {
    labelKey: 'Deleted',
    variant: 'danger' as const,
    value: USER_STATUS.DELETED,
  },
} as const

export const getUserStatusOptions = (t: (key: string) => string) => [
  { label: t('Enabled'), value: String(USER_STATUS.ENABLED) },
  { label: t('Disabled'), value: String(USER_STATUS.DISABLED) },
  { label: t('Deleted'), value: String(USER_STATUS.DELETED) },
]

// ============================================================================
// User Role Configuration
// ============================================================================

export const USER_ROLE = {
  USER: 1,
  ADMIN: 10,
  ROOT: 100,
} as const

export const USER_ROLES = {
  [USER_ROLE.USER]: {
    labelKey: 'User',
    value: USER_ROLE.USER,
    icon: User,
  },
  [USER_ROLE.ADMIN]: {
    labelKey: 'Admin',
    value: USER_ROLE.ADMIN,
    icon: Users,
  },
  [USER_ROLE.ROOT]: {
    labelKey: 'Root',
    value: USER_ROLE.ROOT,
    icon: Shield,
  },
} as const

export const getUserRoleOptions = (t: (key: string) => string) => [
  { label: t('User'), value: String(USER_ROLE.USER), icon: User },
  { label: t('Admin'), value: String(USER_ROLE.ADMIN), icon: Users },
  { label: t('Root'), value: String(USER_ROLE.ROOT), icon: Shield },
]

export const REGISTRATION_SOURCE = {
  UNKNOWN: 0,
  PASSWORD: 1,
  GITHUB: 2,
  DISCORD: 3,
  OIDC: 4,
  LINUXDO: 5,
  WECHAT: 6,
  TELEGRAM: 7,
  CUSTOM_OAUTH: 8,
} as const

export const USER_REGISTRATION_SOURCES = {
  [REGISTRATION_SOURCE.UNKNOWN]: { labelKey: 'Unknown' },
  [REGISTRATION_SOURCE.PASSWORD]: { labelKey: 'Password Registration' },
  [REGISTRATION_SOURCE.GITHUB]: { labelKey: 'GitHub' },
  [REGISTRATION_SOURCE.DISCORD]: { labelKey: 'Discord' },
  [REGISTRATION_SOURCE.OIDC]: { labelKey: 'OIDC' },
  [REGISTRATION_SOURCE.LINUXDO]: { labelKey: 'LinuxDO' },
  [REGISTRATION_SOURCE.WECHAT]: { labelKey: 'WeChat' },
  [REGISTRATION_SOURCE.TELEGRAM]: { labelKey: 'Telegram' },
  [REGISTRATION_SOURCE.CUSTOM_OAUTH]: { labelKey: 'Custom OAuth' },
} as const

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_GROUP = 'default' as const

// ============================================================================
// Third-party Binding Fields
// ============================================================================

export const BINDING_FIELDS = [
  { key: 'github_id', label: 'GitHub ID' },
  { key: 'discord_id', label: 'Discord ID' },
  { key: 'oidc_id', label: 'OIDC ID' },
  { key: 'wechat_id', label: 'WeChat ID' },
  { key: 'email', label: 'Email' },
  { key: 'telegram_id', label: 'Telegram ID' },
  { key: 'linux_do_id', label: 'LinuxDO ID' },
] as const

// ============================================================================
// Error Messages (i18n keys: use t(ERROR_MESSAGES.xxx) when displaying)
// ============================================================================

export const ERROR_MESSAGES = {
  UNEXPECTED: 'An unexpected error occurred',
  NO_USER: 'No user selected',
  LOAD_FAILED: 'Failed to load users',
  SEARCH_FAILED: 'Failed to search users',
  CREATE_FAILED: 'Failed to create user',
  UPDATE_FAILED: 'Failed to update user',
  DELETE_FAILED: 'Failed to delete user',
} as const

// ============================================================================
// Success Messages (i18n keys: use t(SUCCESS_MESSAGES.xxx) when displaying)
// ============================================================================

export const SUCCESS_MESSAGES = {
  USER_CREATED: 'User created successfully',
  USER_UPDATED: 'User updated successfully',
} as const
