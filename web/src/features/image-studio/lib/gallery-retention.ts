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
import { GALLERY_MAX_ENTRIES, GALLERY_RETENTION_MS } from '../constants'
import type { GalleryRecord } from '../types'

export interface RetentionOutcome {
  /** Survivors, newest first. */
  kept: GalleryRecord[]
  /** Ids to delete. */
  droppedIds: string[]
}

/**
 * Decide what the gallery keeps.
 *
 * Two rules, both applied on every read and write so the promise shown to the
 * user holds without a background job: nothing older than the retention window
 * survives, and never more than the entry cap — oldest first out. The cap
 * exists because each entry can hold a full-size image, and an unbounded
 * gallery would eventually hit the browser's storage quota.
 */
export function selectRetained(
  records: readonly GalleryRecord[],
  now: number
): RetentionOutcome {
  const cutoff = now - GALLERY_RETENTION_MS
  const kept = [...records]
    .sort((left, right) => right.createdAt - left.createdAt)
    .filter((record) => record.createdAt >= cutoff)
    .slice(0, GALLERY_MAX_ENTRIES)

  const keptIds = new Set(kept.map((record) => record.id))
  const droppedIds = records
    .filter((record) => !keptIds.has(record.id))
    .map((record) => record.id)

  return { kept, droppedIds }
}
