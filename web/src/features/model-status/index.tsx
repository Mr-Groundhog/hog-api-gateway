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
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api, getUserGroups } from '@/lib/api'
import { cn } from '@/lib/utils'

import type { ModelStatusModel, ModelStatusResponse } from './types'

type SortKey = 'success_rate' | 'request_count' | 'avg_latency_ms' | 'avg_tps'

type SortDir = 'asc' | 'desc'

function sortValue(row: ModelStatusModel, key: SortKey): number {
  return row[key]
}

function formatMs(ms: number): string {
  if (ms <= 0) return '—'
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${Math.round(ms)}ms`
}

function formatRate(row: ModelStatusModel): string {
  return row.request_count > 0 ? `${row.success_rate.toFixed(2)}%` : '—'
}

function formatTps(tps: number): string {
  return tps > 0 ? tps.toFixed(2) : '—'
}

export function ModelStatus() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [hours, setHours] = useState<number>(168)
  const [group, setGroup] = useState<string>('')
  const [keyword, setKeyword] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('success_rate')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const statusQuery = useQuery({
    queryKey: ['model-status', hours, group],
    queryFn: async () => {
      const res = await api.get<ModelStatusResponse>('/api/model-status', {
        params: { hours, group: group || undefined },
      })
      return res.data
    },
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  })

  const groupsQuery = useQuery({
    queryKey: ['model-status-groups'],
    queryFn: getUserGroups,
    staleTime: 5 * 60 * 1000,
  })

  const data = statusQuery.data?.data
  const summary = data?.summary ?? null

  const groupOptions = useMemo(() => {
    const raw = groupsQuery.data?.data ?? {}
    return Object.keys(raw).sort((a, b) => a.localeCompare(b))
  }, [groupsQuery.data])

  const rows = useMemo(() => {
    const list = data?.models ?? []
    const kw = keyword.trim().toLowerCase()
    const filtered = kw
      ? list.filter((row) => row.model_name.toLowerCase().includes(kw))
      : list
    const direction = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort(
      (a, b) => (sortValue(a, sortKey) - sortValue(b, sortKey)) * direction
    )
  }, [data, keyword, sortKey, sortDir])

  const hourOptions = [
    { value: 1, label: t('Last hour') },
    { value: 24, label: t('Last 24 hours') },
    { value: 72, label: t('Last 3 days') },
    { value: 168, label: t('Last 7 days') },
    { value: 720, label: t('Last 30 days') },
  ]

  const sortOptions: { value: SortKey; label: string }[] = [
    { value: 'success_rate', label: t('Sort by success rate') },
    { value: 'request_count', label: t('Sort by requests') },
    { value: 'avg_latency_ms', label: t('Sort by average response') },
    { value: 'avg_tps', label: t('Sort by output speed') },
  ]

  // 数值列表头统一可点击排序：首次点击按该列降序，再次点击切换升降序。
  const toggleSort = (key: SortKey) => {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('desc')
      return
    }
    setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
  }

  const sortableColumns: { key: SortKey; label: string }[] = [
    { key: 'success_rate', label: t('Success rate') },
    { key: 'request_count', label: t('Requests') },
    { key: 'avg_latency_ms', label: t('Avg response') },
    { key: 'avg_tps', label: t('Output speed (tokens/s)') },
  ]

  const statusBadge = (row: ModelStatusModel) => {
    if (row.request_count <= 0) {
      return { label: '—', className: 'border-border text-muted-foreground' }
    }
    if (row.success_rate >= 90) {
      return {
        label: t('Normal'),
        className: 'border-emerald-500/40 text-emerald-600',
      }
    }
    if (row.success_rate >= 80) {
      return {
        label: t('Unstable'),
        className: 'border-amber-500/40 text-amber-600',
      }
    }
    return { label: t('Abnormal'), className: 'border-red-500/40 text-red-600' }
  }

  const summaryCards = summary
    ? [
        {
          label: t('Overall success rate'),
          value: `${summary.success_rate.toFixed(2)}%`,
          sub: t('{{count}} requests', {
            count: summary.request_count.toLocaleString(),
          }),
        },
        {
          label: t('Average response'),
          value: formatMs(summary.avg_latency_ms),
          sub: t('Weighted by request volume'),
        },
        {
          label: t('Monitored models'),
          value: String(summary.model_count),
          sub: t('{{count}} requests', {
            count: summary.request_count.toLocaleString(),
          }),
        },
      ]
    : []

  const loading = statusQuery.isLoading

  return (
    <PublicLayout showMainContainer={false}>
      <PageTransition>
        <div className='mx-auto w-full max-w-6xl px-3 pt-16 pb-8 sm:px-6 sm:pt-20 sm:pb-10'>
          {/* 标题与口径说明 */}
          <h1 className='text-2xl font-semibold'>{t('Model Status')}</h1>
          <p className='text-muted-foreground mt-2 text-sm'>
            {t(
              'Model status metrics aggregated from real traffic across the site: success rate, request volume, average response time, and output speed (tokens/s). Success rate reflects server-side outcomes only; user-side request errors and client cancellations are excluded.'
            )}
          </p>

          {/* 筛选栏 */}
          <div className='mt-6 flex flex-wrap items-center gap-3'>
            <select
              className='border-input bg-background h-9 rounded-md border px-3 text-sm'
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              aria-label={t('Time range')}
            >
              {hourOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              className='border-input bg-background h-9 rounded-md border px-3 text-sm'
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              aria-label={t('Group')}
            >
              <option value=''>{t('All groups')}</option>
              {groupOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>

            <input
              className='border-input bg-background h-9 flex-1 rounded-md border px-3 text-sm'
              placeholder={t('Search model name, optional')}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />

            <select
              className='border-input bg-background h-9 rounded-md border px-3 text-sm'
              value={sortKey}
              onChange={(e) => {
                setSortKey(e.target.value as SortKey)
                setSortDir('desc')
              }}
              aria-label={t('Sort by')}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <button
              type='button'
              className='bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-md px-4 text-sm'
              onClick={() =>
                queryClient.invalidateQueries({ queryKey: ['model-status'] })
              }
            >
              {t('Refresh')}
            </button>
          </div>

          {/* 整体汇总卡片 */}
          {loading && (
            <div className='mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3'>
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className='h-24 rounded-lg' />
              ))}
            </div>
          )}
          {!loading && summary && (
            <div className='mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3'>
              {summaryCards.map((card) => (
                <div key={card.label} className='bg-card rounded-lg border p-4'>
                  <div className='text-muted-foreground text-xs'>
                    {card.label}
                  </div>
                  <div className='mt-1 text-2xl font-semibold'>
                    {card.value}
                  </div>
                  <div className='text-muted-foreground mt-1 text-xs'>
                    {card.sub}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 分模型列表：窄屏用卡片，宽屏用表格 */}
          <div className='mt-6'>
            {loading && (
              <div className='space-y-2 rounded-lg border p-4'>
                {[0, 1, 2].map((index) => (
                  <Skeleton key={index} className='h-8 w-full' />
                ))}
              </div>
            )}
            {!loading && rows.length === 0 && (
              <div className='text-muted-foreground rounded-lg border p-8 text-center text-sm'>
                {t('No model status data')}
              </div>
            )}
            {!loading && rows.length > 0 && (
              <>
                <div
                  className='space-y-2 md:hidden'
                  data-slot='model-status-cards'
                >
                  {rows.map((row) => {
                    const badge = statusBadge(row)
                    return (
                      <div
                        key={row.model_name}
                        data-slot='model-status-card'
                        className='rounded-lg border p-3'
                      >
                        <div className='flex flex-wrap items-center justify-between gap-2'>
                          <span className='min-w-0 truncate font-medium'>
                            {row.model_name}
                          </span>
                          <span
                            className={cn(
                              'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs',
                              badge.className
                            )}
                          >
                            {badge.label}
                          </span>
                        </div>
                        <dl className='mt-2 grid grid-cols-2 gap-x-3 gap-y-2'>
                          <div className='min-w-0'>
                            <dt className='text-muted-foreground text-xs'>
                              {t('Success rate')}
                            </dt>
                            <dd className='mt-0.5 tabular-nums'>
                              {formatRate(row)}
                            </dd>
                          </div>
                          <div className='min-w-0'>
                            <dt className='text-muted-foreground text-xs'>
                              {t('Requests')}
                            </dt>
                            <dd className='mt-0.5 tabular-nums'>
                              {row.request_count.toLocaleString()}
                            </dd>
                          </div>
                          <div className='min-w-0'>
                            <dt className='text-muted-foreground text-xs'>
                              {t('Avg response')}
                            </dt>
                            <dd className='mt-0.5 tabular-nums'>
                              {formatMs(row.avg_latency_ms)}
                            </dd>
                          </div>
                          <div className='min-w-0'>
                            <dt className='text-muted-foreground text-xs'>
                              {t('Output speed (tokens/s)')}
                            </dt>
                            <dd className='mt-0.5 tabular-nums'>
                              {formatTps(row.avg_tps)}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    )
                  })}
                </div>
                <div className='hidden overflow-x-auto rounded-lg border md:block'>
                  <table className='w-full text-sm'>
                    <thead>
                      <tr className='bg-muted/50 border-b text-left'>
                        <th className='px-4 py-2.5 font-medium whitespace-nowrap'>
                          {t('Model')}
                        </th>
                        <th className='px-4 py-2.5 font-medium whitespace-nowrap'>
                          {t('Status')}
                        </th>
                        {sortableColumns.map((column) => {
                          const active = sortKey === column.key
                          let ariaSort: 'ascending' | 'descending' | undefined
                          let icon = <ChevronsUpDown aria-hidden='true' />
                          if (active) {
                            ariaSort =
                              sortDir === 'desc' ? 'descending' : 'ascending'
                            icon =
                              sortDir === 'desc' ? (
                                <ArrowDown aria-hidden='true' />
                              ) : (
                                <ArrowUp aria-hidden='true' />
                              )
                          }
                          return (
                            <th
                              key={column.key}
                              className='px-4 py-2.5 text-right font-medium whitespace-nowrap'
                              aria-sort={ariaSort}
                            >
                              <Button
                                variant='ghost'
                                size='sm'
                                className='-me-2.5 text-xs font-medium'
                                onClick={() => toggleSort(column.key)}
                              >
                                {column.label}
                                {icon}
                              </Button>
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const badge = statusBadge(row)
                        return (
                          <tr
                            key={row.model_name}
                            className='hover:bg-muted/30 border-b last:border-b-0'
                          >
                            <td className='max-w-64 truncate px-4 py-2.5 font-medium'>
                              {row.model_name}
                            </td>
                            <td className='px-4 py-2.5'>
                              <span
                                className={cn(
                                  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs',
                                  badge.className
                                )}
                              >
                                {badge.label}
                              </span>
                            </td>
                            <td className='px-4 py-2.5 text-right tabular-nums'>
                              {formatRate(row)}
                            </td>
                            <td className='px-4 py-2.5 text-right tabular-nums'>
                              {row.request_count.toLocaleString()}
                            </td>
                            <td className='px-4 py-2.5 text-right tabular-nums'>
                              {formatMs(row.avg_latency_ms)}
                            </td>
                            <td className='px-4 py-2.5 text-right tabular-nums'>
                              {formatTps(row.avg_tps)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </PageTransition>
    </PublicLayout>
  )
}
