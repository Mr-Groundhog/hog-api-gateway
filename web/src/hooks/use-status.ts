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

import type { SystemStatus } from '@/features/auth/types'
import { getStatus } from '@/lib/api'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { mapStatusDataToConfig } from './use-system-config'

// Get initial cache from localStorage
function getInitialStatus(): SystemStatus | undefined {
  try {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('status')
      return saved ? (JSON.parse(saved) as SystemStatus) : undefined
    }
  } catch {
    /* empty */
  }
  return undefined
}

export function useStatus() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['status'],
    queryFn: async () => {
      const status = await getStatus()
      try {
        if (status) {
          const { setConfig } = useSystemConfigStore.getState()
          setConfig(mapStatusDataToConfig(status))
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn(
            '[useStatus] Failed to sync status to system config',
            err
          )
        }
      }
      // Save to localStorage
      try {
        if (typeof window !== 'undefined' && status) {
          window.localStorage.setItem('status', JSON.stringify(status))
        }
      } catch {
        /* empty */
      }
      return status as SystemStatus | null
    },
    // Use localStorage data as initial data
    placeholderData: getInitialStatus(),
    // Re-validate frequently so broadcast changes show up without a manual refresh
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    // Cache expires after 30 minutes
    gcTime: 30 * 60 * 1000,
  })

  // Prefer the freshly fetched data; fall back to the latest localStorage
  // snapshot (written by this same hook) so broadcasts stay visible even when
  // the in-memory react-query cache is still serving a stale empty payload.
  const initial = getInitialStatus()
  return {
    status: data ?? initial ?? null,
    loading: isLoading,
    error,
  }
}
