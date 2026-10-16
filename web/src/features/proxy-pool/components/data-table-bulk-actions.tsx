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
import type { Table } from '@tanstack/react-table'
import { Power, PowerOff, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTableBulkActions as BulkActionsToolbar } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import {
  handleBatchProxyDelete,
  handleBatchProxyStatus,
  handleTestProxies,
} from '../lib/proxy-pool-actions'
import type { ProxyEntry } from '../types'

interface DataTableBulkActionsProps<TData> {
  table: Table<TData>
  canWrite: boolean
  canOperate: boolean
}

export function DataTableBulkActions<TData>(
  props: DataTableBulkActionsProps<TData>
) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isTesting, setIsTesting] = useState(false)

  const selectedIds = props.table
    .getFilteredSelectedRowModel()
    .rows.reduce<number[]>((ids, row) => {
      const id = (row.original as ProxyEntry).id
      if (typeof id === 'number') {
        ids.push(id)
      }
      return ids
    }, [])

  const clearSelection = () => {
    props.table.resetRowSelection()
  }

  const handleTest = async () => {
    setIsTesting(true)
    try {
      await handleTestProxies(selectedIds, queryClient)
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <>
      <BulkActionsToolbar table={props.table} entityName='proxy'>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='outline'
                size='icon'
                className='size-8'
                disabled={!props.canOperate || isTesting}
                onClick={() => void handleTest()}
                aria-label={t('Test selected proxies')}
                title={t('Test selected proxies')}
              />
            }
          >
            <RefreshCw aria-hidden='true' />
            <span className='sr-only'>{t('Test selected proxies')}</span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('Test selected proxies')}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='outline'
                size='icon'
                className='size-8'
                disabled={!props.canOperate}
                onClick={() =>
                  void handleBatchProxyStatus(
                    selectedIds,
                    true,
                    queryClient,
                    clearSelection
                  )
                }
                aria-label={t('Enable selected proxies')}
                title={t('Enable selected proxies')}
              />
            }
          >
            <Power aria-hidden='true' />
            <span className='sr-only'>{t('Enable selected proxies')}</span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('Enable selected proxies')}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='outline'
                size='icon'
                className='size-8'
                disabled={!props.canOperate}
                onClick={() =>
                  void handleBatchProxyStatus(
                    selectedIds,
                    false,
                    queryClient,
                    clearSelection
                  )
                }
                aria-label={t('Disable selected proxies')}
                title={t('Disable selected proxies')}
              />
            }
          >
            <PowerOff aria-hidden='true' />
            <span className='sr-only'>{t('Disable selected proxies')}</span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('Disable selected proxies')}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='destructive'
                size='icon'
                className='size-8'
                disabled={!props.canWrite}
                onClick={() => setShowDeleteConfirm(true)}
                aria-label={t('Delete selected proxies')}
                title={t('Delete selected proxies')}
              />
            }
          >
            <Trash2 aria-hidden='true' />
            <span className='sr-only'>{t('Delete selected proxies')}</span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('Delete selected proxies')}</p>
          </TooltipContent>
        </Tooltip>
      </BulkActionsToolbar>

      <Dialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={t('Delete Proxies?')}
        description={t(
          'Deleting {{count}} selected proxy(ies) cannot be undone. Channels using the proxy pool will stop using them immediately.',
          { count: selectedIds.length }
        )}
        contentHeight='auto'
        footer={
          <>
            <Button
              variant='outline'
              onClick={() => setShowDeleteConfirm(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              variant='destructive'
              onClick={() => {
                void handleBatchProxyDelete(selectedIds, queryClient, () => {
                  setShowDeleteConfirm(false)
                  clearSelection()
                })
              }}
            >
              {t('Delete')}
            </Button>
          </>
        }
      >
        {' '}
      </Dialog>
    </>
  )
}
