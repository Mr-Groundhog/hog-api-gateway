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

/** Whether the typed value is a URL a browser could actually call. */
export function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Normalise a typed base URL into an OpenAI-compatible API root, or `''` when
 * it is not usable.
 *
 * Users type either the host or the versioned root, and both mean the same
 * endpoint, so a trailing slash is dropped and `/v1` is appended unless the
 * address already carries a version segment.
 */
export function resolveApiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!isAbsoluteHttpUrl(trimmed)) {
    return ''
  }
  return /\/v\d+[a-z]*$/i.test(trimmed) ? trimmed : `${trimmed}/v1`
}

/** The id of one entry in a model list, in whichever shape it arrived. */
function readModelId(entry: unknown): string {
  if (typeof entry === 'string') {
    return entry
  }
  if (entry && typeof entry === 'object' && 'id' in entry) {
    const id = (entry as { id: unknown }).id
    return typeof id === 'string' ? id : ''
  }
  return ''
}

/**
 * The model ids an OpenAI-compatible list endpoint returned.
 *
 * The endpoint may answer with `{ data: [{ id }] }`, `{ data: ["id"] }` or a
 * bare array of either, so all four shapes are read; ids are trimmed, deduped
 * and sorted so the dropdown is stable across refreshes.
 */
export function parseCustomModelList(payload: unknown): string[] {
  const candidate =
    payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data: unknown }).data
      : payload
  if (!Array.isArray(candidate)) {
    return []
  }

  const ids = new Set<string>()
  for (const entry of candidate) {
    const id = readModelId(entry).trim()
    if (id) {
      ids.add(id)
    }
  }
  return [...ids].sort((left, right) => left.localeCompare(right))
}
