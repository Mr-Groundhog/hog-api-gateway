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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnFiltersState, PaginationState } from '@tanstack/react-table'
import { RefreshCw } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { getProxyList, setProxyStatusBatch } from '../api'
import { DEFAULT_PAGE_SIZE } from '../constants'
import { proxyPoolQueryKeys } from '../lib/proxy-pool-actions'
import type { ProxyEntry } from '../types'
import { DataTableBulkActions } from './data-table-bulk-actions'
import { useProxyColumns } from './proxy-columns'

interface ProxyPoolTableProps {
  canWrite: boolean
  canOperate: boolean
  onEdit: (proxy: ProxyEntry) => void
  onDelete: (proxy: ProxyEntry) => void
  onTest: (proxy: ProxyEntry) => void
}

export function ProxyPoolTable(props: ProxyPoolTableProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  })
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')

  const enabledFilter = columnFilters.find((filter) => filter.id === 'enabled')
    ?.value as string[] | undefined
  const enabledParam = useMemo(() => {
    const selected = enabledFilter?.find((value) => value !== 'all')
    if (selected === 'true') return true
    if (selected === 'false') return false
    return undefined
  }, [enabledFilter])

  const listParams = useMemo(
    () => ({
      keyword: globalFilter,
      enabled: enabledParam,
      p: pagination.pageIndex + 1,
      page_size: pagination.pageSize,
    }),
    [enabledParam, globalFilter, pagination.pageIndex, pagination.pageSize]
  )

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: proxyPoolQueryKeys.list(listParams),
    queryFn: async () =>
      requireServerSuccess(
        await getProxyList({
          keyword: globalFilter || undefined,
          enabled: enabledParam,
          p: listParams.p,
          page_size: listParams.page_size,
        })
      ),
    placeholderData: (previousData) => previousData,
  })

  const entries = data?.data?.items ?? []
  const totalCount = data?.data?.total ?? 0

  const handleToggle = useCallback(
    async (proxy: ProxyEntry, enabled: boolean) => {
      try {
        const response = await setProxyStatusBatch([proxy.id], enabled)
        if (!response.success) {
          handleServerError(response, t('Operation failed'))
          return
        }
        queryClient.invalidateQueries({ queryKey: proxyPoolQueryKeys.lists() })
        queryClient.invalidateQueries({
          queryKey: proxyPoolQueryKeys.summary(),
        })
      } catch (error) {
        handleServerError(error, t('Operation failed'))
      }
    },
    [queryClient, t]
  )

  const columns = useProxyColumns({
    enableSelection: true,
    canWrite: props.canWrite,
    canOperate: props.canOperate,
    onEdit: props.onEdit,
    onDelete: props.onDelete,
    onTest: props.onTest,
    onToggle: handleToggle,
  })

  const { table } = useDataTable({
    data: entries,
    columns,
    totalCount,
    columnFilters,
    pagination,
    globalFilter,
    enableRowSelection: true,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    onGlobalFilterChange: setGlobalFilter,
    manualPagination: true,
    manualFiltering: true,
    manualSorting: true,
    getRowId: (row: ProxyEntry) => String(row.id),
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No Proxies Found')}
      emptyDescription={t(
        'Add or import proxies first, then enable dynamic proxy on the channels that should randomly use them.'
      )}
      skeletonKeyPrefix='proxy-skeleton'
      toolbarProps={{
        collapsibleOnMobile: true,
        searchPlaceholder: t('Filter by proxy address or exit IP...'),
        searchDebounceMs: 500,
        filters: [
          {
            columnId: 'enabled',
            title: t('Available'),
            singleSelect: true,
            options: [
              { label: t('All'), value: 'all' },
              { label: t('Enabled'), value: 'true' },
              { label: t('Disabled'), value: 'false' },
            ],
          },
        ],
        preActions: (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => void refetch()}
                  aria-label={t('Refresh')}
                  aria-busy={isFetching}
                  className='text-muted-foreground hover:text-foreground size-8'
                />
              }
            >
              <RefreshCw className={cn(isFetching && 'animate-spin')} />
            </TooltipTrigger>
            <TooltipContent>{t('Refresh')}</TooltipContent>
          </Tooltip>
        ),
      }}
      bulkActions={
        <DataTableBulkActions
          table={table}
          canWrite={props.canWrite}
          canOperate={props.canOperate}
        />
      }
    />
  )
}
