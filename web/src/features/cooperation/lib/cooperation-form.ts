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

import { COOPERATION_SITE_TYPE_KEYS, COOPERATION_VALIDATION } from '../constants'
import type {
  CooperationSiteTypeKey,
  CreateCooperationPayload,
  SaveCooperationSitePayload,
} from '../types'

/** 与后端 utf8.RuneCountInString 一致：按 Unicode 码点计数而非 UTF-16 code unit。 */
export const runeLength = (value: string) => [...value].length

/** 与后端 NormalizeTicketContent 一致：把 CRLF / 孤立 CR 统一成 LF。 */
export function normalizeCooperationText(value: string) {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

/** 与后端 url.Parse 校验一致：必须是带 host 的 http(s) 链接。 */
function isValidHttpUrl(value: string) {
  try {
    const parsed = new URL(value)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.host !== ''
    )
  } catch {
    return false
  }
}

// 表单值类型与 schema 推断保持一致（siteType / methods 用宽类型 string，
// 白名单校验由 refine 负责），否则 zodResolver 与 useForm 泛型对不上
export type CooperationFormValues = {
  siteName: string
  siteUrl: string
  siteBanner: string
  siteType: string
  description: string
  audience: string
  methods: string[]
  contact: string
  notes: string
}

export const COOPERATION_FORM_DEFAULT_VALUES: CooperationFormValues = {
  siteName: '',
  siteUrl: '',
  siteBanner: '',
  siteType: '',
  description: '',
  audience: '',
  methods: [],
  contact: '',
  notes: '',
}

export function getCooperationFormSchema(t: TFunction) {
  return z.object({
    siteName: z
      .string()
      .trim()
      .refine(
        (v) =>
          runeLength(v) >= 1 &&
          runeLength(v) <= COOPERATION_VALIDATION.SITE_NAME_MAX_LENGTH,
        t('Site name must be between {{min}} and {{max}} characters', {
          min: 1,
          max: COOPERATION_VALIDATION.SITE_NAME_MAX_LENGTH,
        })
      ),
    siteUrl: z
      .string()
      .trim()
      .refine(
        (v) =>
          runeLength(v) <= COOPERATION_VALIDATION.SITE_URL_MAX_LENGTH &&
          isValidHttpUrl(v),
        t('Site URL must be a valid http(s) link')
      ),
    siteBanner: z
      .string()
      .trim()
      .refine(
        (v) =>
          v === '' ||
          (runeLength(v) <= COOPERATION_VALIDATION.SITE_URL_MAX_LENGTH &&
            isValidHttpUrl(v)),
        t('Site banner must be a valid http(s) image URL')
      ),
    siteType: z
      .string()
      .refine(
        (v) => COOPERATION_SITE_TYPE_KEYS.includes(v as CooperationSiteTypeKey),
        t('Invalid site type')
      ),
    description: z
      .string()
      .transform(normalizeCooperationText)
      .transform((v) => v.trim())
      .refine(
        (v) =>
          runeLength(v) >= 1 &&
          runeLength(v) <= COOPERATION_VALIDATION.DESCRIPTION_MAX_LENGTH,
        t('Site description must be between {{min}} and {{max}} characters', {
          min: 1,
          max: COOPERATION_VALIDATION.DESCRIPTION_MAX_LENGTH,
        })
      ),
    audience: z
      .string()
      .trim()
      .refine(
        (v) =>
          runeLength(v) >= 1 &&
          runeLength(v) <= COOPERATION_VALIDATION.AUDIENCE_MAX_LENGTH,
        t('Audience size must be between {{min}} and {{max}} characters', {
          min: 1,
          max: COOPERATION_VALIDATION.AUDIENCE_MAX_LENGTH,
        })
      ),
    methods: z
      .array(z.string())
      // 只校验非空：方式标识的合法性由「表单仅渲染管理端开放方式」与服务端
      // gate（setting.GetEnabledCooperationMethodIds）共同保证
      .refine((v) => v.length > 0, t('Please select at least one cooperation method')),
    contact: z
      .string()
      .trim()
      .refine(
        (v) =>
          runeLength(v) >= 1 &&
          runeLength(v) <= COOPERATION_VALIDATION.CONTACT_MAX_LENGTH,
        t(
          'Contact information must be between {{min}} and {{max}} characters',
          {
            min: 1,
            max: COOPERATION_VALIDATION.CONTACT_MAX_LENGTH,
          }
        )
      ),
    notes: z
      .string()
      .transform(normalizeCooperationText)
      .transform((v) => v.trim())
      .refine(
        (v) => runeLength(v) <= COOPERATION_VALIDATION.NOTES_MAX_LENGTH,
        t('Additional notes cannot exceed {{max}} characters', {
          max: COOPERATION_VALIDATION.NOTES_MAX_LENGTH,
        })
      ),
  })
}

/** 提交前归一化换行并去掉首尾空白，与后端校验双端一致。 */
export function transformCooperationFormToPayload(
  values: CooperationFormValues
): CreateCooperationPayload {
  return {
    site_name: values.siteName.trim(),
    site_url: values.siteUrl.trim(),
    site_banner: values.siteBanner.trim(),
    site_type: values.siteType,
    description: normalizeCooperationText(values.description).trim(),
    audience: values.audience.trim(),
    methods: values.methods,
    contact: values.contact.trim(),
    notes: normalizeCooperationText(values.notes).trim(),
  }
}

// ============================================================================
// 合作站点条目表单（管理端）
// ============================================================================

export const COOPERATION_SITE_VALIDATION = {
  NAME_MAX_LENGTH: 50,
  URL_MAX_LENGTH: 200,
  DESCRIPTION_MAX_LENGTH: 200,
} as const

export type CooperationSiteFormValues = {
  name: string
  url: string
  logo: string
  banner: string
  siteType: string
  description: string
  sort: string
  featured: boolean
  enabled: boolean
}

export const COOPERATION_SITE_FORM_DEFAULT_VALUES: CooperationSiteFormValues = {
  name: '',
  url: '',
  logo: '',
  banner: '',
  siteType: '',
  description: '',
  sort: '0',
  featured: false,
  enabled: true,
}

export function getCooperationSiteFormSchema(t: TFunction) {
  return z.object({
    name: z
      .string()
      .trim()
      .refine(
        (v) =>
          runeLength(v) >= 1 &&
          runeLength(v) <= COOPERATION_SITE_VALIDATION.NAME_MAX_LENGTH,
        t('Site name must be between {{min}} and {{max}} characters', {
          min: 1,
          max: COOPERATION_SITE_VALIDATION.NAME_MAX_LENGTH,
        })
      ),
    url: z
      .string()
      .trim()
      .refine(
        (v) =>
          runeLength(v) <= COOPERATION_SITE_VALIDATION.URL_MAX_LENGTH &&
          isValidHttpUrl(v),
        t('Site URL must be a valid http(s) link')
      ),
    logo: z
      .string()
      .trim()
      .refine(
        (v) =>
          v === '' ||
          (runeLength(v) <= COOPERATION_SITE_VALIDATION.URL_MAX_LENGTH &&
            isValidHttpUrl(v)),
        t('Logo and banner must be valid http(s) image URLs')
      ),
    banner: z
      .string()
      .trim()
      .refine(
        (v) =>
          v === '' ||
          (runeLength(v) <= COOPERATION_SITE_VALIDATION.URL_MAX_LENGTH &&
            isValidHttpUrl(v)),
        t('Logo and banner must be valid http(s) image URLs')
      ),
    siteType: z
      .string()
      .refine(
        (v) =>
          v === '' || COOPERATION_SITE_TYPE_KEYS.includes(v as CooperationSiteTypeKey),
        t('Invalid site type')
      ),
    description: z
      .string()
      .trim()
      .refine(
        (v) =>
          runeLength(v) <= COOPERATION_SITE_VALIDATION.DESCRIPTION_MAX_LENGTH,
        t('Site description cannot exceed {{max}} characters', {
          max: COOPERATION_SITE_VALIDATION.DESCRIPTION_MAX_LENGTH,
        })
      ),
    sort: z
      .string()
      .trim()
      .refine((v) => /^-?\d+$/.test(v), t('Sort order must be an integer')),
    featured: z.boolean(),
    enabled: z.boolean(),
  })
}

/** 提交前组装管理端创建 / 更新合作站点的请求体；editingId 存在时为更新。 */
export function transformCooperationSiteFormToPayload(
  values: CooperationSiteFormValues,
  editingId?: number
): SaveCooperationSitePayload {
  return {
    id: editingId,
    name: values.name.trim(),
    url: values.url.trim(),
    logo: values.logo.trim(),
    banner: values.banner.trim(),
    site_type: values.siteType,
    description: values.description.trim(),
    featured: values.featured,
    sort: Number(values.sort) || 0,
    enabled: values.enabled,
  }
}
