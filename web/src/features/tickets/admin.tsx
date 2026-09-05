/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useDataTable } from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { useTableUrlState } from '@/hooks/use-table-url-state'

import { buildAdminTicketParams, getAdminTickets, ticketQueryKeys } from './api'
import { AdminTicketDetailSheet } from './components/admin-ticket-detail-sheet'
import {
  type TicketColumnsScope,
  useTicketsColumns,
} from './components/ticket-columns'
import { TicketDataTable } from './components/ticket-data-table'
import { TicketFiltersBar } from './components/ticket-filters-bar'
import { useTicketAdminStats } from './hooks/use-ticket-admin-stats'
import type { AdminTicketFilters } from './types'

const route = getRouteApi('/_authenticated/ticket-management/')

const EMPTY_FILTERS: AdminTicketFilters = {
  status: '',
  type: '',
  keyword: '',
  user: '',
}

/**
 * 管理端「工单管理」页面：统计与筛选工具栏 + 全量工单表格 + 详情抽屉。
 * 表格使用与用量日志一致的 DataTablePage 结构，固定表头并在页面底部渲染通用分页。
 */
export function TicketManagement() {
  const { t } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()

  const { pagination, onPaginationChange, ensurePageInRange } =
    useTableUrlState({
      search,
      navigate,
      pagination: { defaultPage: 1, defaultPageSize: 20 },
      globalFilter: { enabled: false },
    })

  const [filters, setFilters] = useState<AdminTicketFilters>(() => ({
    ...EMPTY_FILTERS,
    status: search.status ? String(search.status) : '',
    type: search.type ? String(search.type) : '',
    keyword: search.keyword ?? '',
  }))
  const [detailId, setDetailId] = useState<number | null>(null)

  const statsQuery = useTicketAdminStats()
  const listQuery = useQuery({
    queryKey: [
      ...ticketQueryKeys.adminList,
      pagination.pageIndex + 1,
      pagination.pageSize,
      filters,
    ],
    queryFn: () =>
      getAdminTickets(
        buildAdminTicketParams(
          filters,
          pagination.pageIndex + 1,
          pagination.pageSize
        )
      ),
    placeholderData: (previousData) => previousData,
  })

  const handleOpenTicket = useCallback((id: number) => setDetailId(id), [])
  const columns = useTicketsColumns({
    scope: 'admin' satisfies TicketColumnsScope,
    onOpenTicket: handleOpenTicket,
  })
  const items = listQuery.data?.items ?? []
  const total = listQuery.data?.total ?? 0

  const { table } = useDataTable({
    data: items,
    columns,
    columnFilters: [],
    pagination,
    onPaginationChange,
    enableRowSelection: false,
    enableSorting: false,
    manualPagination: true,
    manualFiltering: true,
    totalCount: total,
    ensurePageInRange,
  })

  const patchSearch = (updates: {
    page?: number
    status?: number
    type?: number
    keyword?: string
  }) => {
    void navigate({
      search: (prev) => ({ ...prev, ...updates }),
    })
  }

  const handleSearch = (next: AdminTicketFilters) => {
    setFilters(next)
    patchSearch({
      page: 1,
      status: next.status ? Number(next.status) : undefined,
      type: next.type ? Number(next.type) : undefined,
      keyword: next.keyword || undefined,
    })
  }

  const handleReset = () => {
    setFilters(EMPTY_FILTERS)
    patchSearch({
      page: 1,
      status: undefined,
      type: undefined,
      keyword: undefined,
    })
  }

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        {t('Ticket Management')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 flex-col gap-4'>
          <div className='min-h-0 flex-1'>
            <TicketDataTable
              table={table}
              columns={columns}
              toolbar={
                <TicketFiltersBar
                  scope='admin'
                  table={table}
                  fetching={listQuery.isFetching}
                  stats={statsQuery.data}
                  statsLoading={statsQuery.isLoading}
                  onSearch={handleSearch}
                  onRefresh={() => void listQuery.refetch()}
                  onReset={handleReset}
                />
              }
              isLoading={listQuery.isLoading}
              isFetching={listQuery.isFetching}
              onOpenTicket={handleOpenTicket}
              emptyTitle={t('No tickets yet')}
              emptyDescription={t(
                'Submitted tickets will appear here for admin review and replies.'
              )}
              skeletonKeyPrefix='admin-ticket-skeleton'
            />
          </div>

          <AdminTicketDetailSheet
            open={detailId !== null}
            onOpenChange={(open) => {
              if (!open) setDetailId(null)
            }}
            ticketId={detailId}
          />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
