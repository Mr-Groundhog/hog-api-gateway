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
import z from 'zod'

/**
 * A proxy pool entry as returned by the admin API. `url` is always masked
 * (`scheme://user:***@host:port`); credentials are never sent to the browser.
 */
export interface ProxyEntry {
  id: number
  url: string
  enabled: boolean
  latency_ms: number
  exit_ip: string
  last_check_time: number
  last_check_ok: boolean
  last_error: string
  created_time: number
  updated_time: number
}

export interface ProxyListResponse {
  success: boolean
  message?: string
  data?: {
    page: number
    page_size: number
    total: number
    items: ProxyEntry[]
  }
}

export interface ProxySummaryResponse {
  success: boolean
  message?: string
  data?: {
    total: number
    enabled: number
    pool_enabled: number
    loaded_at: number
    check_url: string
    max_batch: number
    /** 定时检测开关与间隔，配置入口在“设置 → 请求策略 → 代理池”。 */
    auto_check_enabled: boolean
    auto_check_minutes: number
  }
}

export interface ProxyMutationResponse {
  success: boolean
  message?: string
  data?: ProxyEntry
}

export interface ProxySimpleResponse {
  success: boolean
  message?: string
  data?: unknown
}

export interface ProxyBatchDeleteResult {
  deleted: number
}

export interface ProxyBatchStatusResult {
  updated: number
}

export interface ProxyInvalidLine {
  line: number
  preview: string
  reason: string
}

export interface ProxyImportResult {
  added: number
  duplicated: number
  invalid: number
  invalid_lines: ProxyInvalidLine[]
}

export interface ProxyTestResult {
  id: number
  url: string
  ok: boolean
  latency_ms: number
  exit_ip: string
  error?: string
}

export interface ProxyTestResponse {
  success: boolean
  message?: string
  data?: {
    results: ProxyTestResult[]
  }
}

export interface GetProxyListParams {
  p?: number
  page_size?: number
  keyword?: string
  enabled?: boolean
}

export interface CreateProxyParams {
  url: string
  enabled?: boolean
}

export interface UpdateProxyParams {
  id: number
  /** Leave empty to keep the stored address unchanged. */
  url?: string
  enabled?: boolean
}

export interface TestProxiesParams {
  ids?: number[]
  url?: string
}

export const proxyEntrySchema = z.object({
  id: z.number(),
  url: z.string(),
  enabled: z.boolean(),
  latency_ms: z.number(),
  exit_ip: z.string(),
  last_check_time: z.number(),
  last_check_ok: z.boolean(),
  last_error: z.string(),
  created_time: z.number(),
  updated_time: z.number(),
})

/** Client-side validation mirroring the backend proxy URL rules. */
export const proxyUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      return false
    }
    if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol)) {
      return false
    }
    if (!parsed.hostname) return false
    if (parsed.pathname && parsed.pathname !== '/') return false
    if (parsed.search || parsed.hash) return false
    if (parsed.port) {
      const port = Number(parsed.port)
      if (!Number.isInteger(port) || port < 1 || port > 65535) return false
    }
    return true
  })

export const proxyMutateSchema = z.object({
  url: z.string().trim(),
  enabled: z.boolean(),
})

export type ProxyMutateValues = z.infer<typeof proxyMutateSchema>
