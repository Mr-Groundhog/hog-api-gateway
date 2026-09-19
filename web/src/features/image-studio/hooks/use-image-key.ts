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
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { fetchTokenKey, getApiKeys } from '@/features/keys/api'
import { API_KEY_STATUS } from '@/features/keys/constants'
import type { ApiKey } from '@/features/keys/types'
import {
  createServerError,
  requireServerSuccess,
} from '@/lib/server-error-message'

export interface ImageKeyOption {
  id: number
  name: string
  group: string
  remainQuota: number
  unlimitedQuota: boolean
}

const KEYS_QUERY_KEY = ['image-studio-keys'] as const

function toKeyOption(item: ApiKey): ImageKeyOption {
  return {
    id: item.id,
    name: item.name,
    group: item.group ?? '',
    remainQuota: item.remain_quota,
    unlimitedQuota: item.unlimited_quota,
  }
}

/**
 * Generate with a key the user created, exactly like the chat share links do:
 * the list endpoint only returns masked values, so the real key is fetched on
 * demand from the per-token endpoint, which is scoped to the owner.
 *
 * The resolved `sk-` key stays in the query cache (memory) only — never in
 * localStorage — and the fetch is audited server-side by TokenOperationAudit.
 *
 * Pass `enabled: false` while the workbench draws with the user's own endpoint:
 * nothing here is needed then, and no key should be resolved for nothing.
 */
export function useImageApiKey(enabled = true) {
  const keysQuery = useQuery({
    queryKey: KEYS_QUERY_KEY,
    queryFn: async (): Promise<ImageKeyOption[]> => {
      const result = requireServerSuccess(await getApiKeys({ p: 1, size: 100 }))
      const items = result.data?.items ?? []
      return items
        .filter((item) => item.status === API_KEY_STATUS.ENABLED)
        .map(toKeyOption)
    },
    staleTime: 60_000,
    enabled,
  })

  const keys = useMemo(() => keysQuery.data ?? [], [keysQuery.data])
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      return
    }
    if (keys.length === 0) {
      if (selectedKeyId !== null) {
        setSelectedKeyId(null)
      }
      return
    }
    const stillAvailable = keys.some((key) => key.id === selectedKeyId)
    if (!stillAvailable) {
      setSelectedKeyId(keys[0]?.id ?? null)
    }
  }, [enabled, keys, selectedKeyId])

  const selectedKey = useMemo(
    () => keys.find((key) => key.id === selectedKeyId) ?? null,
    [keys, selectedKeyId]
  )

  const keyQuery = useQuery({
    queryKey: ['image-studio-key', selectedKeyId],
    enabled: enabled && selectedKeyId !== null,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async (): Promise<string> => {
      const result = await fetchTokenKey(selectedKeyId as number)
      if (!result.success || !result.data?.key) {
        throw createServerError(result, 'Failed to load API keys')
      }
      return `sk-${result.data.key}`
    },
  })

  return {
    keys,
    selectedKey,
    selectKey: setSelectedKeyId,
    apiKey: enabled ? (keyQuery.data ?? '') : '',
    isLoading: enabled && (keysQuery.isLoading || keyQuery.isLoading),
    error: enabled ? (keysQuery.error ?? keyQuery.error) : null,
  }
}
