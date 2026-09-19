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
import { useCallback, useState } from 'react'

import { loadCustomEndpoint, saveCustomEndpoint } from '../lib/storage'
import type { CustomEndpoint } from '../types'

/**
 * The endpoint the user configured for their own key.
 *
 * It is read from and written to this browser's storage — the key is a
 * credential the user handed us, and it must never be uploaded to this site.
 */
export function useCustomEndpoint() {
  const [customEndpoint, setCustomEndpoint] =
    useState<CustomEndpoint>(loadCustomEndpoint)

  const updateCustomEndpoint = useCallback(
    (patch: Partial<CustomEndpoint>): void => {
      setCustomEndpoint((previous) => {
        const next = { ...previous, ...patch }
        saveCustomEndpoint(next)
        return next
      })
    },
    []
  )

  return { customEndpoint, updateCustomEndpoint }
}
