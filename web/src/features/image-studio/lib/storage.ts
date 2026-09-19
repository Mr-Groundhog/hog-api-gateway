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

import { IMAGE_KEY_SOURCES, STORAGE_KEYS } from '../constants'
import type { CustomEndpoint, ImageStudioConfig } from '../types'

const STORAGE_VERSION = 1

const imageStudioConfigSchema = z.object({
  model: z.string(),
  size: z.string(),
  ratio: z.string(),
  resolution: z.string(),
  quality: z.string(),
  format: z.string(),
  showAllModels: z.boolean(),
  // Configs saved before the source control existed were all system-key ones,
  // so an absence is filled in instead of resetting the whole config.
  keySource: z
    .enum([IMAGE_KEY_SOURCES.SYSTEM, IMAGE_KEY_SOURCES.CUSTOM])
    .catch(IMAGE_KEY_SOURCES.SYSTEM),
})

const customEndpointSchema = z.object({
  baseUrl: z.string(),
  apiKey: z.string(),
})

type StoredEnvelope = {
  version: number
  data: unknown
}

export const DEFAULT_CONFIG: ImageStudioConfig = {
  keySource: IMAGE_KEY_SOURCES.SYSTEM,
  model: '',
  size: '1024x1024',
  ratio: '1:1',
  resolution: '1K',
  quality: '',
  format: 'png',
  showAllModels: false,
}

export const DEFAULT_CUSTOM_ENDPOINT: CustomEndpoint = {
  baseUrl: '',
  apiKey: '',
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

/**
 * Read the user's own endpoint.
 *
 * It is stored on its own rather than inside the config because it carries a
 * credential, and it never leaves this browser: generations that use it are
 * sent straight from the page to the endpoint.
 */
export function loadCustomEndpoint(): CustomEndpoint {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOM_ENDPOINT)
    if (!raw) {
      return DEFAULT_CUSTOM_ENDPOINT
    }
    const parsed: unknown = JSON.parse(raw)
    const candidate =
      parsed && typeof parsed === 'object' && 'data' in parsed
        ? (parsed as StoredEnvelope).data
        : parsed
    const result = customEndpointSchema.safeParse(candidate)
    if (!result.success) {
      return DEFAULT_CUSTOM_ENDPOINT
    }
    return result.data
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load the image studio custom endpoint:', error)
    return DEFAULT_CUSTOM_ENDPOINT
  }
}

/** Persist the user's own endpoint; it is never uploaded to the server. */
export function saveCustomEndpoint(endpoint: CustomEndpoint): void {
  try {
    const payload: StoredEnvelope = { version: STORAGE_VERSION, data: endpoint }
    localStorage.setItem(STORAGE_KEYS.CUSTOM_ENDPOINT, JSON.stringify(payload))
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save the image studio custom endpoint:', error)
  }
}
