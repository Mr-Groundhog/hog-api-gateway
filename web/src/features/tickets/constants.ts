/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import type { TFunction } from 'i18next'

import type { StatusBadgeProps } from '@/components/status-badge'

import { TICKET_STATUS, TICKET_TYPE } from './types'

// ============================================================================
// Ticket Type Configuration
// ============================================================================

// labelKey values are i18n keys; use t(config.labelKey) in components
export const TICKET_TYPES: Record<number, { labelKey: string; value: number }> =
  {
    [TICKET_TYPE.API_CALL]: {
      labelKey: 'API Calls',
      value: TICKET_TYPE.API_CALL,
    },
    [TICKET_TYPE.ACCOUNT]: {
      labelKey: 'Account Issue',
      value: TICKET_TYPE.ACCOUNT,
    },
    [TICKET_TYPE.BILLING]: {
      labelKey: 'Billing Issue',
      value: TICKET_TYPE.BILLING,
    },
    [TICKET_TYPE.OTHER]: { labelKey: 'Other', value: TICKET_TYPE.OTHER },
  }

export const TICKET_TYPE_VALUES: number[] = Object.values(TICKET_TYPES).map(
  (config) => config.value
)

export function getTicketTypeOptions(t: TFunction) {
  return Object.values(TICKET_TYPES).map((config) => ({
    label: t(config.labelKey),
    value: String(config.value),
  }))
}

// ============================================================================
// Ticket Status Configuration
// ============================================================================

export const TICKET_STATUSES: Record<
  number,
  Pick<StatusBadgeProps, 'variant'> & { labelKey: string; value: number }
> = {
  // 「Awaiting Reply」而非共享键 'Pending'（后者已存在且 zh 译为「待确认」，
  // 语义与本模块需求「待处理」不一致）
  [TICKET_STATUS.PENDING]: {
    labelKey: 'Awaiting Reply',
    variant: 'warning',
    value: TICKET_STATUS.PENDING,
  },
  [TICKET_STATUS.REPLIED]: {
    labelKey: 'Replied',
    variant: 'success',
    value: TICKET_STATUS.REPLIED,
  },
  [TICKET_STATUS.CLOSED]: {
    labelKey: 'Closed',
    variant: 'neutral',
    value: TICKET_STATUS.CLOSED,
  },
}

export function getTicketStatusOptions(t: TFunction) {
  return Object.values(TICKET_STATUSES).map((config) => ({
    label: t(config.labelKey),
    value: String(config.value),
  }))
}

// ============================================================================
// Validation Constants（与后端 service.MaxTicket* 上限保持一致）
// ============================================================================

export const TICKET_VALIDATION = {
  TITLE_MAX_LENGTH: 50,
  CONTENT_MAX_LENGTH: 1000,
} as const

// ============================================================================
// Error Messages
// ============================================================================

// i18n keys; use t(ERROR_MESSAGES.xxx) when displaying. For form schema with
// interpolation use getTicketFormErrorMessages(t).
export const ERROR_MESSAGES = {
  TYPE_INVALID: 'Invalid ticket type',
  TITLE_LENGTH: 'Title must be between {{min}} and {{max}} characters',
  CONTENT_LENGTH: 'Content must be between {{min}} and {{max}} characters',
  CREATE_FAILED: 'Failed to submit ticket',
  LOAD_FAILED: 'Failed to load tickets',
  REPLY_FAILED: 'Failed to submit reply',
  CLOSE_FAILED: 'Failed to close ticket',
  DELETE_FAILED: 'Failed to delete ticket',
  STATUS_UPDATE_FAILED: 'Failed to update ticket status',
} as const

/** For form schema only: returns translated messages with interpolation. */
export function getTicketFormErrorMessages(t: TFunction) {
  return {
    TYPE_INVALID: t(ERROR_MESSAGES.TYPE_INVALID),
    TITLE_LENGTH: t(ERROR_MESSAGES.TITLE_LENGTH, {
      min: 1,
      max: TICKET_VALIDATION.TITLE_MAX_LENGTH,
    }),
    CONTENT_LENGTH: t(ERROR_MESSAGES.CONTENT_LENGTH, {
      min: 1,
      max: TICKET_VALIDATION.CONTENT_MAX_LENGTH,
    }),
  } as const
}

// ============================================================================
// Success Messages (i18n keys; use t(SUCCESS_MESSAGES.xxx) when displaying)
// ============================================================================

export const SUCCESS_MESSAGES = {
  TICKET_CREATED: 'Ticket submitted successfully',
  TICKET_CLOSED: 'Ticket closed',
  TICKET_REOPENED: 'Ticket reopened',
  TICKET_DELETED: 'Ticket deleted',
} as const
