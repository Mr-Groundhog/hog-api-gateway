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
import { z } from 'zod'

import {
  REGISTRATION_VALIDATION,
  getRegistrationCodeFormErrorMessages,
} from '../constants'
import type { RegistrationCodeFormData, RegistrationCode } from '../types'

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a Unix timestamp (in seconds) is expired
 * @param timestamp - Unix timestamp in seconds (0 means never expires)
 * @returns true if the timestamp is in the past
 */
export function isTimestampExpired(timestamp: number): boolean {
  if (timestamp === 0) return false
  return timestamp < Date.now() / 1000
}

/**
 * Check if registration code is expired based on business logic
 * Only enabled registration codes (status === 1) can be considered expired
 */
export function isRegistrationExpired(
  expired_time: number,
  status: number
): boolean {
  return status === 1 && isTimestampExpired(expired_time)
}

// ============================================================================
// Form Utilities
// ============================================================================

export function getRegistrationCodeFormSchema(t: TFunction) {
  const msg = getRegistrationCodeFormErrorMessages(t)
  return z.object({
    name: z
      .string()
      .min(
        REGISTRATION_VALIDATION.NAME_MIN_LENGTH,
        msg.NAME_LENGTH_INVALID
      )
      .max(
        REGISTRATION_VALIDATION.NAME_MAX_LENGTH,
        msg.NAME_LENGTH_INVALID
      ),
    expired_time: z.date().optional(),
    count: z
      .number()
      .min(REGISTRATION_VALIDATION.COUNT_MIN, msg.COUNT_INVALID)
      .max(REGISTRATION_VALIDATION.COUNT_MAX, msg.COUNT_INVALID)
      .optional(),
  })
}

export type RegistrationCodeFormValues = {
  name: string
  expired_time?: Date
  count?: number
}

export const REGISTRATION_CODE_FORM_DEFAULT_VALUES: RegistrationCodeFormValues =
  {
    name: '',
    expired_time: undefined,
    count: 1,
  }

/**
 * Transform form data to API payload
 */
export function transformFormDataToPayload(
  data: RegistrationCodeFormValues
): RegistrationCodeFormData {
  return {
    name: data.name,
    expired_time: data.expired_time
      ? Math.floor(data.expired_time.getTime() / 1000)
      : 0,
    count: data.count || 1,
  }
}

/**
 * Transform registration code data to form defaults
 */
export function transformRegistrationCodeToFormDefaults(
  code: RegistrationCode
): RegistrationCodeFormValues {
  return {
    name: code.name,
    expired_time:
      code.expired_time > 0
        ? new Date(code.expired_time * 1000)
        : undefined,
    count: 1,
  }
}
