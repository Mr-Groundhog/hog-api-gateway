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
import { useMemo } from 'react'

import type { ComboboxInputOption } from '@/components/ui/combobox-input'
import { isServerErrorCancelled } from '@/lib/server-error-message'

import { fetchCustomEndpointModels } from '../api'
import { resolveApiBaseUrl } from '../lib/custom-endpoint'

interface UseCustomModelsOptions {
  /** False while the workbench draws with a key of this site. */
  enabled: boolean
  baseUrl: string
  apiKey: string
}

/**
 * The models the user's own endpoint serves.
 *
 * The endpoint is the authority on what it offers, so the returned list is used
 * verbatim — no keyword guesswork as on the site's own list. A fetch needs both
 * halves of the endpoint, and reruns when either changes, so correcting a
 * mistyped address or key is enough to reload the list.
 */
export function useCustomModels(options: UseCustomModelsOptions) {
  const baseUrl = resolveApiBaseUrl(options.baseUrl)
  const query = useQuery({
    queryKey: ['image-studio-custom-models', baseUrl, options.apiKey],
    enabled:
      options.enabled && baseUrl !== '' && options.apiKey.trim().length > 0,
    queryFn: ({ signal }) =>
      fetchCustomEndpointModels(baseUrl, options.apiKey, signal),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  })

  const models = useMemo<ComboboxInputOption[]>(
    () =>
      (query.data ?? []).map((name) => ({
        value: name,
        label: name,
      })),
    [query.data]
  )

  return {
    models,
    isFetching: query.isFetching,
    // An aborted request is the user's own doing, not a failure to report.
    error:
      query.error && !isServerErrorCancelled(query.error) ? query.error : null,
    refetch: query.refetch,
  }
}
