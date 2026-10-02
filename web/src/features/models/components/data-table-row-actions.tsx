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
import { useQueryClient } from '@tanstack/react-query'
import type { Row } from '@tanstack/react-table'
import {
  CircleDollarSign,
  Loader2,
  Pencil,
  Power,
  PowerOff,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTableRowActionMenu } from '@/components/data-table/core/row-action-menu'
import { Button } from '@/components/ui/button'
import {
  DropdownMenuItem,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useCanEditModelPricing } from '@/features/model-pricing/api'

import { handleToggleModelStatus, isModelEnabled } from '../lib'
import type { Model } from '../types'
import { ModelDeleteDialog } from './dialogs/model-delete-dialog'
import { useModels } from './models-provider'

interface DataTableRowActionsProps {
  row: Row<Model>
}

export function DataTableRowActions({ row }: DataTableRowActionsProps) {
  const { t } = useTranslation()
  const canPrice = useCanEditModelPricing()
  const model = row.original
  const { setOpen, setCurrentRow } = useModels()
  const queryClient = useQueryClient()
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [toggling, setToggling] = useState(false)

  const isEnabled = isModelEnabled(model)
  const editLabel = model.id > 0 ? t('Edit') : t('Add metadata')
  const toggleLabel = isEnabled ? t('Disable model') : t('Enable model')

  const handleEdit = () => {
    setCurrentRow(model)
    setOpen('update-model')
  }

  const handleToggleStatus = async () => {
    if (toggling) return
    setToggling(true)
    try {
      await handleToggleModelStatus(model.id, model.status, queryClient)
    } finally {
      setToggling(false)
    }
  }

  let toggleIcon = <Power className='size-4' />
  if (toggling) {
    toggleIcon = <Loader2 className='size-4 animate-spin' />
  } else if (isEnabled) {
    toggleIcon = <PowerOff className='size-4' />
  }

  return (
    <div className='-ml-1.5 flex min-w-0 items-center gap-1'>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={handleEdit}
              aria-label={editLabel}
            />
          }
        >
          <Pencil className='size-4' />
        </TooltipTrigger>
        <TooltipContent>{editLabel}</TooltipContent>
      </Tooltip>

      {canPrice && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='ghost'
                size='icon-sm'
                onClick={() => {
                  setCurrentRow(model)
                  setOpen('price-model')
                }}
                aria-label={t('Pricing')}
              />
            }
          >
            <CircleDollarSign className='size-4' />
          </TooltipTrigger>
          <TooltipContent>{t('Pricing')}</TooltipContent>
        </Tooltip>
      )}

      {model.id > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='ghost'
                size='icon-sm'
                onClick={handleToggleStatus}
                disabled={toggling}
                aria-label={toggleLabel}
                className={
                  isEnabled
                    ? 'text-destructive hover:text-destructive'
                    : 'text-success hover:text-success'
                }
              />
            }
          >
            {toggleIcon}
          </TooltipTrigger>
          <TooltipContent>{toggleLabel}</TooltipContent>
        </Tooltip>
      )}

      {model.id > 0 && (
        <DataTableRowActionMenu ariaLabel={t('Open menu')}>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              setDeleteConfirmOpen(true)
            }}
            className='text-destructive focus:text-destructive'
          >
            {t('Delete')}
            <DropdownMenuShortcut>
              <Trash2 size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        </DataTableRowActionMenu>
      )}

      {deleteConfirmOpen && (
        <ModelDeleteDialog
          models={[model]}
          onClose={() => setDeleteConfirmOpen(false)}
        />
      )}
    </div>
  )
}
