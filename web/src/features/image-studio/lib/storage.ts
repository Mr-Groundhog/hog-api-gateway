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
import { z } from 'zod'

import { STORAGE_KEYS } from '../constants'
import type { ImageStudioConfig } from '../types'

const STORAGE_VERSION = 1

const imageStudioConfigSchema = z.object({
  model: z.string(),
  size: z.string(),
  ratio: z.string(),
  resolution: z.string(),
  quality: z.string(),
  format: z.string(),
  n: z.number().int().min(1),
  showAllModels: z.boolean(),
})

type StoredEnvelope = {
  version: number
  data: unknown
}

export const DEFAULT_CONFIG: ImageStudioConfig = {
  model: '',
  size: '1024x1024',
  ratio: '1:1',
  resolution: '1K',
  quality: '',
  format: 'png',
  n: 1,
  showAllModels: false,
}

/**
 * Read the persisted config, tolerating both the versioned envelope and a bare
 * legacy value. Anything unreadable or failing validation falls back to the
 * defaults, so a stale or hand-edited entry can never break the page.
 */
export function loadConfig(): ImageStudioConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CONFIG)
    if (!raw) {
      return DEFAULT_CONFIG
    }
    const parsed: unknown = JSON.parse(raw)
    const candidate =
      parsed && typeof parsed === 'object' && 'data' in parsed
        ? (parsed as StoredEnvelope).data
        : parsed
    const result = imageStudioConfigSchema.safeParse(candidate)
    if (!result.success) {
      return DEFAULT_CONFIG
    }
    return result.data
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load image studio config:', error)
    return DEFAULT_CONFIG
  }
}

/** Persist the config; failures are logged and never block the UI. */
export function saveConfig(config: ImageStudioConfig): void {
  try {
    const payload: StoredEnvelope = { version: STORAGE_VERSION, data: config }
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(payload))
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save image studio config:', error)
  }
}
