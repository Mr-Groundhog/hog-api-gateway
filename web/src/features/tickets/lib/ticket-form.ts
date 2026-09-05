/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import type { TFunction } from 'i18next'
import { z } from 'zod'

import { TICKET_TYPE } from '../types'
import {
  TICKET_TYPE_VALUES,
  TICKET_VALIDATION,
  getTicketFormErrorMessages,
} from '../constants'

/** 与后端 utf8.RuneCountInString 一致：按 Unicode 码点计数而非 UTF-16 code unit。 */
export const runeLength = (value: string) => [...value].length

/** 与后端 NormalizeTicketContent 一致：入库前把 CRLF / 孤立 CR 统一成 LF。 */
export function normalizeTicketContent(value: string) {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

export function getTicketFormSchema(t: TFunction) {
  const msg = getTicketFormErrorMessages(t)
  return z.object({
    type: z
      .number()
      .int()
      .refine((v) => TICKET_TYPE_VALUES.includes(v), msg.TYPE_INVALID),
    title: z
      .string()
      .trim()
      .refine(
        (v) =>
          runeLength(v) >= 1 && runeLength(v) <= TICKET_VALIDATION.TITLE_MAX_LENGTH,
        msg.TITLE_LENGTH
      ),
    content: z
      .string()
      .transform(normalizeTicketContent)
      .transform((v) => v.trim())
      .refine(
        (v) =>
          runeLength(v) >= 1 &&
          runeLength(v) <= TICKET_VALIDATION.CONTENT_MAX_LENGTH,
        msg.CONTENT_LENGTH
      ),
  })
}

export type TicketFormValues = {
  type: number
  title: string
  content: string
}

export const TICKET_FORM_DEFAULT_VALUES: TicketFormValues = {
  type: TICKET_TYPE.API_CALL, // 需求指定默认「api调用」
  title: '',
  content: '',
}

/** 提交前归一化换行并去掉首尾空白，与后端校验双端一致。 */
export function transformTicketFormToPayload(values: TicketFormValues) {
  return {
    type: values.type,
    title: values.title.trim(),
    content: normalizeTicketContent(values.content).trim(),
  }
}
