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

// ============================================================================
// Registration Code Status Configuration (shares status values with redemptions)
// ============================================================================

export const REGISTRATION_STATUS = {
  ENABLED: 1,
  DISABLED: 2,
  USED: 3,
} as const

export const REGISTRATION_STATUS_VALUES = Object.values(
  REGISTRATION_STATUS
).map((value) => String(value)) as `${number}`[]

// labelKey values are i18n keys; use t(config.labelKey) in components
export const REGISTRATION_STATUSES: Record<
  number,
  Pick<StatusBadgeProps, 'variant'> & {
    labelKey: string
    value: number
  }
> = {
  [REGISTRATION_STATUS.ENABLED]: {
    labelKey: 'Unused',
    variant: 'success',
    value: REGISTRATION_STATUS.ENABLED,
  },
  [REGISTRATION_STATUS.DISABLED]: {
    labelKey: 'Disabled',
    variant: 'neutral',
    value: REGISTRATION_STATUS.DISABLED,
  },
  [REGISTRATION_STATUS.USED]: {
    labelKey: 'Used',
    variant: 'neutral',
    value: REGISTRATION_STATUS.USED,
  },
} as const

// Virtual status filter value for expired registration codes
// Note: "Expired" is not a real DB status, it's computed from expired_time
export const REGISTRATION_FILTER_EXPIRED = 'expired'

export const REGISTRATION_FILTER_VALUES = [
  String(REGISTRATION_STATUS.ENABLED),
  String(REGISTRATION_STATUS.DISABLED),
  String(REGISTRATION_STATUS.USED),
  REGISTRATION_FILTER_EXPIRED,
] as const

export function getRegistrationStatusOptions(t: TFunction) {
  return [
    ...Object.values(REGISTRATION_STATUSES).map((config) => ({
      label: t(config.labelKey),
      value: String(config.value),
    })),
    {
      label: t('Expired'),
      value: REGISTRATION_FILTER_EXPIRED,
    },
  ]
}

// ============================================================================
// Validation Constants
// ============================================================================

export const REGISTRATION_VALIDATION = {
  NAME_MIN_LENGTH: 1,
  NAME_MAX_LENGTH: 20,
  COUNT_MIN: 1,
  COUNT_MAX: 100,
} as const

// ============================================================================
// Error Messages
// ============================================================================

// i18n keys; use t(ERROR_MESSAGES.xxx) when displaying. For form schema with interpolation use getRegistrationCodeFormErrorMessages(t).
export const ERROR_MESSAGES = {
  LOAD_FAILED: 'Failed to load registration codes',
  SEARCH_FAILED: 'Failed to search registration codes',
  CREATE_FAILED: 'Failed to create registration code',
  UPDATE_FAILED: 'Failed to update registration code',
  DELETE_FAILED: 'Failed to delete registration code',
  DELETE_INVALID_FAILED: 'Failed to delete invalid registration codes',
  STATUS_UPDATE_FAILED: 'Failed to update registration code status',
  NAME_LENGTH_INVALID: 'Name must be between {{min}} and {{max}} characters',
  COUNT_INVALID: 'Count must be between {{min}} and {{max}}',
  EXPIRED_TIME_INVALID: 'Expired time cannot be earlier than current time',
} as const

/** For form schema only: returns translated messages with interpolation. */
export function getRegistrationCodeFormErrorMessages(t: TFunction) {
  return {
    NAME_LENGTH_INVALID: t(ERROR_MESSAGES.NAME_LENGTH_INVALID, {
      min: REGISTRATION_VALIDATION.NAME_MIN_LENGTH,
      max: REGISTRATION_VALIDATION.NAME_MAX_LENGTH,
    }),
    COUNT_INVALID: t(ERROR_MESSAGES.COUNT_INVALID, {
      min: REGISTRATION_VALIDATION.COUNT_MIN,
      max: REGISTRATION_VALIDATION.COUNT_MAX,
    }),
    EXPIRED_TIME_INVALID: t(ERROR_MESSAGES.EXPIRED_TIME_INVALID),
  } as const
}

// ============================================================================
// Success Messages (i18n keys; use t(SUCCESS_MESSAGES.xxx) when displaying)
// ============================================================================

export const SUCCESS_MESSAGES = {
  REGISTRATION_CODE_CREATED: 'Registration code(s) created successfully',
  REGISTRATION_CODE_UPDATED: 'Registration code updated successfully',
  REGISTRATION_CODE_DELETED: 'Registration code deleted successfully',
  REGISTRATION_CODE_ENABLED: 'Registration code enabled successfully',
  REGISTRATION_CODE_DISABLED: 'Registration code disabled successfully',
} as const
