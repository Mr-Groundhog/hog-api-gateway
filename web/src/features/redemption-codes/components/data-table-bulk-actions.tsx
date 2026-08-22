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
import { Ban, Download, LoaderCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { type Table } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { DataTableBulkActions as BulkActionsToolbar } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { updateRedemptionStatus } from '../api'
import type { Redemption } from '../types'
import { useRedemptions } from './redemptions-provider'

type DataTableBulkActionsProps<TData> = {
  table: Table<TData>
}

export function DataTableBulkActions<TData>({
  table,
}: DataTableBulkActionsProps<TData>) {
  const { t } = useTranslation()
  const { triggerRefresh } = useRedemptions()
  const [isDisabling, setIsDisabling] = useState(false)
  const selectedRows = table.getSelectedRowModel().rows

  const contentToCopy = useMemo(() => {
    const selectedCodes = selectedRows.map((row) => {
      const redemption = row.original as Redemption
      return `${redemption.name}\t${redemption.key}`
    })
    return selectedCodes.join('\n')
  }, [selectedRows])

  const codesToExport = useMemo(
    () =>
      selectedRows
        .map((row) => (row.original as Redemption).key)
        .filter((key): key is string => Boolean(key)),
    [selectedRows]
  )

  const handleExport = () => {
    if (codesToExport.length === 0 || typeof window === 'undefined') {
      return
    }

    const blob = new Blob([codesToExport.join('\n')], {
      type: 'text/plain;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `redemption-codes-${codesToExport.length}.txt`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const handleBulkDisable = async () => {
    const targets = selectedRows
      .map((row) => row.original as Redemption)
      .filter((redemption) => redemption.status === 1)
    if (targets.length === 0 || isDisabling) {
      return
    }
    setIsDisabling(true)
    try {
      const results = await Promise.all(
        targets.map((redemption) => updateRedemptionStatus(redemption.id, 2))
      )
      const failed = results.filter((result) => !result.success).length
      if (failed > 0) {
        toast.error(
          t('Failed to disable {{count}} codes', { count: failed })
        )
      } else {
        toast.success(
          t('Successfully disabled {{count}} codes', {
            count: targets.length,
          })
        )
      }
      triggerRefresh()
    } finally {
      setIsDisabling(false)
    }
  }

  return (
    <BulkActionsToolbar table={table} entityName={t('redemption code')}>
      <CopyButton
        value={contentToCopy}
        variant='outline'
        size='icon'
        className='size-8'
        tooltip={t('Copy selected codes')}
        successTooltip={t('Codes copied!')}
        aria-label={t('Copy selected codes')}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='outline'
              size='icon'
              onClick={handleExport}
              className='size-8'
              aria-label={t('Export selected codes')}
            />
          }
        >
          <Download />
          <span className='sr-only'>{t('Export selected codes')}</span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('Export selected codes')}</p>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='outline'
              size='icon'
              onClick={() => void handleBulkDisable()}
              disabled={isDisabling}
              className='size-8'
              aria-label={t('Disable selected codes')}
            />
          }
        >
          {isDisabling ? (
            <LoaderCircle className='animate-spin' />
          ) : (
            <Ban />
          )}
          <span className='sr-only'>{t('Disable selected codes')}</span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('Disable selected codes')}</p>
        </TooltipContent>
      </Tooltip>
    </BulkActionsToolbar>
  )
}
