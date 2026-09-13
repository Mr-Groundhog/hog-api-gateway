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
import { describe, expect, test } from 'vitest'

import {
  COOPERATION_FORM_DEFAULT_VALUES,
  getCooperationFormSchema,
  runeLength,
  transformCooperationFormToPayload,
  type CooperationFormValues,
} from '../lib/cooperation-form'

// 测试环境不初始化 i18next，键即文案的直通实现即可
const t = ((key: string) => key) as unknown as TFunction

function validValues(): CooperationFormValues {
  return {
    siteName: '  示例站点  ',
    siteUrl: 'https://example.com',
    siteBanner: '  https://cdn.example.com/banner.png  ',
    siteType: 'blog',
    description: '第一行\r\n第二行',
    audience: '日活约 1000',
    methods: ['token', 'invite'],
    contact: 'admin@example.com',
    notes: '  备注\r\n内容  ',
  }
}

describe('cooperation form schema', () => {
  test('accepts valid input', () => {
    const result = getCooperationFormSchema(t).safeParse(validValues())
    expect(result.success).toBe(true)
  })

  test('rejects non-http URL, bare domain and missing host', () => {
    const schema = getCooperationFormSchema(t)
    for (const siteUrl of ['ftp://example.com', 'example.com', 'https://']) {
      const values = { ...validValues(), siteUrl }
      expect(schema.safeParse(values).success).toBe(false)
    }
  })

  test('rejects empty cooperation methods but allows custom ids', () => {
    const schema = getCooperationFormSchema(t)
    expect(schema.safeParse({ ...validValues(), methods: [] }).success).toBe(
      false
    )
    // 自定义方式 id 由管理端配置决定，schema 不再按内置白名单拦截，
    // 成员合法性由服务端 gate 保证
    expect(
      schema.safeParse({ ...validValues(), methods: ['custom_ab12'] }).success
    ).toBe(true)
  })

  test('rejects invalid site type', () => {
    const values = { ...validValues(), siteType: 'mall' }
    expect(getCooperationFormSchema(t).safeParse(values).success).toBe(false)
  })

  test('rejects over-length site name by Unicode code points', () => {
    const values = { ...validValues(), siteName: '站'.repeat(51) }
    expect(getCooperationFormSchema(t).safeParse(values).success).toBe(false)
    expect(runeLength('站'.repeat(51))).toBe(51)
  })

  test('transforms payload with trimming and CRLF normalization', () => {
    const payload = transformCooperationFormToPayload(validValues())
    expect(payload.site_name).toBe('示例站点')
    expect(payload.site_url).toBe('https://example.com')
    expect(payload.site_banner).toBe('https://cdn.example.com/banner.png')
    expect(payload.site_type).toBe('blog')
    expect(payload.description).toBe('第一行\n第二行')
    expect(payload.notes).toBe('备注\n内容')
    expect(payload.methods).toEqual(['token', 'invite'])
    expect(payload.contact).toBe('admin@example.com')
  })

  test('site banner is optional but must be a valid http(s) URL when filled', () => {
    const schema = getCooperationFormSchema(t)
    expect(
      schema.safeParse({ ...validValues(), siteBanner: '' }).success
    ).toBe(true)
    expect(
      schema.safeParse({ ...validValues(), siteBanner: 'cdn.example.com/a.png' })
        .success
    ).toBe(false)
    expect(
      schema.safeParse({
        ...validValues(),
        siteBanner: `https://example.com/${'a'.repeat(181)}`,
      }).success
    ).toBe(false)
  })

  test('default values fail validation until required fields are filled', () => {
    const result = getCooperationFormSchema(t).safeParse(
      COOPERATION_FORM_DEFAULT_VALUES
    )
    expect(result.success).toBe(false)
  })
})
