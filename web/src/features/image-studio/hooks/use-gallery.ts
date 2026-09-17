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
import { useCallback, useEffect, useState } from 'react'

import {
  clearGallery,
  deleteGalleryEntry,
  listGalleryEntries,
  saveGalleryEntry,
} from '../lib/gallery-store'
import type { GalleryRecord, GenerationResult } from '../types'

/**
 * The local gallery: generations made in this browser, kept for a few days.
 *
 * IndexedDB has no change notifications, so the hook owns the list and
 * refreshes it after each mutation rather than subscribing to the store.
 */
export function useGallery() {
  const [entries, setEntries] = useState<GalleryRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const refresh = useCallback(async () => {
    try {
      setEntries(await listGalleryEntries())
      setError(null)
    } catch (cause) {
      // eslint-disable-next-line no-console
      console.error('Failed to read the image gallery:', cause)
      setError(cause)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = useCallback(
    async (result: GenerationResult) => {
      for (const image of result.images) {
        await saveGalleryEntry({
          id: image.id,
          prompt: result.prompt,
          model: result.model,
          src: image.src,
          fileName: image.fileName,
        })
      }
      await refresh()
    },
    [refresh]
  )

  const remove = useCallback(
    async (id: string) => {
      await deleteGalleryEntry(id)
      await refresh()
    },
    [refresh]
  )

  const clear = useCallback(async () => {
    await clearGallery()
    await refresh()
  }, [refresh])

  return { entries, isLoading, error, refresh, save, remove, clear }
}

export type GalleryStore = ReturnType<typeof useGallery>
