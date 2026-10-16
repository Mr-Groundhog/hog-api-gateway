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
import type { ColumnDef } from '@tanstack/react-table'
import {
  Ban,
  CheckCircle2,
  Pencil,
  Power,
  PowerOff,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTableColumnHeader } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { PROXY_LATENCY } from '../constants'
import type { ProxyEntry } from '../types'

interface ProxyColumnsOptions {
  enableSelection?: boolean
  canWrite: boolean
  canOperate: boolean
  onEdit: (proxy: ProxyEntry) => void
  onDelete: (proxy: ProxyEntry) => void
  onTest: (proxy: ProxyEntry) => void
  onToggle: (proxy: ProxyEntry, enabled: boolean) => void
}

function latencyClassName(latencyMs: number): string {
  if (latencyMs <= 0) return 'text-muted-foreground'
  if (latencyMs <= PROXY_LATENCY.fastMs) return 'text-emerald-600'
  if (latencyMs <= PROXY_LATENCY.slowMs) return 'text-amber-600'
  return 'text-rose-600'
}

export function useProxyColumns(
  options: ProxyColumnsOptions
): ColumnDef<ProxyEntry>[] {
  const { t } = useTranslation()
  const {
    enableSelection = true,
    canWrite,
    canOperate,
    onEdit,
    onDelete,
    onTest,
    onToggle,
  } = options

  return useMemo<ColumnDef<ProxyEntry>[]>(
    () => [
      ...(enableSelection
        ? [
            {
              id: 'select',
              header: ({ table }) => (
                <Checkbox
                  checked={table.getIsAllPageRowsSelected()}
                  indeterminate={table.getIsSomePageRowsSelected()}
                  onCheckedChange={(value) =>
                    table.toggleAllPageRowsSelected(!!value)
                  }
                  aria-label={t('Select all')}
                />
              ),
              cell: ({ row }) => (
                <Checkbox
                  checked={row.getIsSelected()}
                  onCheckedChange={(value) => row.toggleSelected(!!value)}
                  aria-label={t('Select row')}
                />
              ),
              enableSorting: false,
              enableHiding: false,
              enableResizing: false,
              size: 40,
            } satisfies ColumnDef<ProxyEntry>,
          ]
        : []),
      {
        accessorKey: 'url',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Proxy Address')} />
        ),
        cell: ({ row }) => (
          <span className='font-mono text-xs break-all'>
            {row.original.url}
          </span>
        ),
        size: 320,
      },
      {
        accessorKey: 'enabled',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Available')} />
        ),
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            disabled={!canOperate}
            onCheckedChange={(checked) => onToggle(row.original, checked)}
            aria-label={t('Available')}
          />
        ),
        size: 90,
      },
      {
        accessorKey: 'latency_ms',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Latency')} />
        ),
        cell: ({ row }) => {
          const latencyMs = row.original.latency_ms
          if (!row.original.last_check_time || latencyMs <= 0) {
            return <span className='text-muted-foreground text-xs'>—</span>
          }
          return (
            <span
              className={cn(
                'font-mono text-xs tabular-nums',
                latencyClassName(latencyMs)
              )}
            >
              {`${latencyMs} ms`}
            </span>
          )
        },
        size: 100,
      },
      {
        accessorKey: 'exit_ip',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Exit IP')} />
        ),
        cell: ({ row }) =>
          row.original.exit_ip ? (
            <span className='font-mono text-xs'>{row.original.exit_ip}</span>
          ) : (
            <span className='text-muted-foreground text-xs'>—</span>
          ),
        size: 140,
      },
      {
        accessorKey: 'last_check_time',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Last Checked')} />
        ),
        cell: ({ row }) => {
          const checkedAt = row.original.last_check_time
          if (!checkedAt) {
            return (
              <span className='text-muted-foreground text-xs'>
                {t('Never checked')}
              </span>
            )
          }
          return (
            <div className='flex flex-col gap-0.5'>
              <span className='font-mono text-xs tabular-nums'>
                {formatTimestampToDate(checkedAt)}
              </span>
              {row.original.last_check_ok ? (
                <span className='inline-flex items-center gap-1 text-xs text-emerald-600'>
                  <CheckCircle2 className='size-3' aria-hidden='true' />
                  {t('Reachable')}
                </span>
              ) : (
                <span className='inline-flex items-center gap-1 text-xs text-rose-600'>
                  <Ban className='size-3' aria-hidden='true' />
                  {t('Unreachable')}
                </span>
              )}
            </div>
          )
        },
        size: 160,
      },
      {
        id: 'last_error',
        accessorFn: (row) => row.last_error,
        header: t('Failure Reason'),
        cell: ({ row }) => {
          const lastError = row.original.last_error
          if (!lastError) {
            return <span className='text-muted-foreground text-xs'>—</span>
          }
          return (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className='text-muted-foreground block max-w-[220px] truncate text-xs' />
                }
              >
                {lastError}
              </TooltipTrigger>
              <TooltipContent className='max-w-sm break-all'>
                {lastError}
              </TooltipContent>
            </Tooltip>
          )
        },
        size: 200,
      },
      {
        id: 'actions',
        header: t('Actions'),
        cell: ({ row }) => {
          const proxy = row.original
          const noPermissionLabel = t('No permission to perform this action')
          const testLabel = canOperate ? t('Test') : noPermissionLabel
          const editLabel = canWrite ? t('Edit') : noPermissionLabel
          const toggleActionLabel = proxy.enabled ? t('Disable') : t('Enable')
          const toggleLabel = canOperate ? toggleActionLabel : noPermissionLabel
          const deleteLabel = canWrite ? t('Delete') : noPermissionLabel

          return (
            <div className='-ml-1.5 flex items-center gap-1'>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      onClick={(event) => {
                        event.stopPropagation()
                        if (!canOperate) return
                        onTest(proxy)
                      }}
                      aria-disabled={!canOperate}
                      aria-label={t('Test')}
                      className={cn(
                        'size-7',
                        !canOperate && 'cursor-not-allowed opacity-50'
                      )}
                    />
                  }
                >
                  <RefreshCw className='size-4' />
                </TooltipTrigger>
                <TooltipContent>{testLabel}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      onClick={(event) => {
                        event.stopPropagation()
                        if (!canWrite) return
                        onEdit(proxy)
                      }}
                      aria-disabled={!canWrite}
                      aria-label={t('Edit')}
                      className={cn(
                        'size-7',
                        !canWrite && 'cursor-not-allowed opacity-50'
                      )}
                    />
                  }
                >
                  <Pencil className='size-4' />
                </TooltipTrigger>
                <TooltipContent>{editLabel}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      onClick={(event) => {
                        event.stopPropagation()
                        if (!canOperate) return
                        onToggle(proxy, !proxy.enabled)
                      }}
                      aria-disabled={!canOperate}
                      aria-label={toggleActionLabel}
                      className={cn(
                        'size-7',
                        proxy.enabled
                          ? 'text-destructive hover:text-destructive'
                          : 'text-success hover:text-success',
                        !canOperate && 'cursor-not-allowed opacity-50'
                      )}
                    />
                  }
                >
                  {proxy.enabled ? (
                    <PowerOff className='size-4' />
                  ) : (
                    <Power className='size-4' />
                  )}
                </TooltipTrigger>
                <TooltipContent>{toggleLabel}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      onClick={(event) => {
                        event.stopPropagation()
                        if (!canWrite) return
                        onDelete(proxy)
                      }}
                      aria-disabled={!canWrite}
                      aria-label={t('Delete')}
                      className={cn(
                        'size-7 text-destructive hover:text-destructive',
                        !canWrite && 'cursor-not-allowed opacity-50'
                      )}
                    />
                  }
                >
                  <Trash2 className='size-4' />
                </TooltipTrigger>
                <TooltipContent>{deleteLabel}</TooltipContent>
              </Tooltip>
            </div>
          )
        },
        enableSorting: false,
        enableHiding: false,
        size: 150,
      },
    ],
    [
      canOperate,
      canWrite,
      enableSelection,
      onDelete,
      onEdit,
      onTest,
      onToggle,
      t,
    ]
  )
}
