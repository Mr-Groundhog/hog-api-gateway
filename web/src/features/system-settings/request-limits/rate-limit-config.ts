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
export const MAX_RATE_LIMIT_VALUE = 2147483647
export const MAX_CLIENT_REGEX_LENGTH = 512

export const CLIENT_REGEX_PRESETS = {
  unrestricted: '',
  codex: '(?i)(?:codex|codex-tui)',
  'claude-code': '(?i)(?:claude-cli|claude)',
} as const

export type ClientPreset = keyof typeof CLIENT_REGEX_PRESETS | 'custom'

export type RateLimitEntryData = {
  groupName: string
  maxRequests: number
  maxSuccess: number
  clientRegex: string
  clientPreset: ClientPreset
}

export type StoredRateLimitConfig = {
  max_requests: number
  max_success: number
  client_regex?: string
}

export function inferClientPreset(clientRegex: string): ClientPreset {
  const preset = Object.entries(CLIENT_REGEX_PRESETS).find(
    ([, regex]) => regex === clientRegex
  )
  return (preset?.[0] as ClientPreset | undefined) ?? 'custom'
}

export function isValidClientRegex(clientRegex: string): boolean {
  if (clientRegex.trim() !== clientRegex) return false
  if ([...clientRegex].length > MAX_CLIENT_REGEX_LENGTH) return false
  if (clientRegex === '') return true

  let source = clientRegex
  let flags = ''
  const inlineFlags = source.match(/^\(\?([ims]+)\)/)
  if (inlineFlags) {
    source = source.slice(inlineFlags[0].length)
    flags = inlineFlags[1]
  }

  try {
    new RegExp(source, flags)
    return true
  } catch {
    return false
  }
}

export function parseRateLimitEntry(
  groupName: string,
  value: unknown
): RateLimitEntryData | null {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  ) {
    return {
      groupName,
      maxRequests: value[0],
      maxSuccess: value[1],
      clientRegex: '',
      clientPreset: 'unrestricted',
    }
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  const config = value as Record<string, unknown>
  if (
    typeof config.max_requests !== 'number' ||
    typeof config.max_success !== 'number' ||
    (config.client_regex !== undefined &&
      typeof config.client_regex !== 'string')
  ) {
    return null
  }

  const clientRegex = config.client_regex ?? ''
  return {
    groupName,
    maxRequests: config.max_requests,
    maxSuccess: config.max_success,
    clientRegex,
    clientPreset: inferClientPreset(clientRegex),
  }
}

export function isValidRateLimitEntry(entry: RateLimitEntryData): boolean {
  return (
    entry.groupName !== '' &&
    entry.groupName.trim() === entry.groupName &&
    Number.isInteger(entry.maxRequests) &&
    entry.maxRequests >= 0 &&
    entry.maxRequests <= MAX_RATE_LIMIT_VALUE &&
    Number.isInteger(entry.maxSuccess) &&
    entry.maxSuccess >= 1 &&
    entry.maxSuccess <= MAX_RATE_LIMIT_VALUE &&
    isValidClientRegex(entry.clientRegex)
  )
}

export function toStoredRateLimitConfig(
  entry: RateLimitEntryData
): StoredRateLimitConfig {
  return {
    max_requests: entry.maxRequests,
    max_success: entry.maxSuccess,
    ...(entry.clientRegex ? { client_regex: entry.clientRegex } : {}),
  }
}
