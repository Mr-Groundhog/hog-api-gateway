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
import { useTranslation } from 'react-i18next'

import type { ComboboxInputOption } from '@/components/ui/combobox-input'
import { useStatus } from '@/hooks/use-status'
import { getUserModels } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { isImageModel } from '../lib/model-capabilities'

/** Parse the admin-configured model list, tolerating an empty or bad value. */
export function parseConfiguredModels(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

export interface ImageModelsResult {
  models: ComboboxInputOption[]
  /** True when the list came from drawing settings rather than the user's group. */
  isAdminConfigured: boolean
  isLoading: boolean
  error: unknown
}

/**
 * Models the image studio offers.
 *
 * The admin's drawing-settings list wins when it is set — it is the operator's
 * explicit decision about what the workbench serves, so it is shown verbatim
 * and the "show all models" escape hatch is irrelevant. With no list
 * configured the page falls back to the user's own group, narrowed to models
 * that look image-capable; `showAllModels` widens that fallback for models the
 * frontend keyword table does not know about.
 */
export function useImageModels(
  group: string,
  showAllModels: boolean
): ImageModelsResult {
  const { t } = useTranslation()
  const { status } = useStatus()
  const configured = useMemo(
    () => parseConfiguredModels(status?.drawing_models),
    [status?.drawing_models]
  )
  const hasConfiguredModels = configured.length > 0

  const query = useQuery({
    queryKey: ['image-studio-models', group],
    queryFn: async (): Promise<string[]> => {
      const result = requireServerSuccess(
        await getUserModels(group || undefined)
      )
      return result.data ?? []
    },
    enabled: !hasConfiguredModels,
    staleTime: 5 * 60 * 1000,
  })

  const models = useMemo<ComboboxInputOption[]>(() => {
    const source = hasConfiguredModels ? configured : (query.data ?? [])
    const all = [...source].sort((left, right) => left.localeCompare(right))

    if (hasConfiguredModels) {
      return all.map((name) => ({ value: name, label: name }))
    }

    return all
      .filter((name) => showAllModels || isImageModel(name))
      .map((name) => {
        const recognized = isImageModel(name)
        return {
          value: name,
          label: name,
          description:
            showAllModels && !recognized
              ? t('May not support image generation')
              : undefined,
        }
      })
  }, [configured, hasConfiguredModels, query.data, showAllModels, t])

  return {
    models,
    isAdminConfigured: hasConfiguredModels,
    isLoading: !hasConfiguredModels && query.isLoading,
    error: hasConfiguredModels ? null : query.error,
  }
}
