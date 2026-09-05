/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useDataTable } from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { useIsAdminSidebarModuleVisible } from '@/hooks/use-sidebar-config'
import { useTableUrlState } from '@/hooks/use-table-url-state'

import { getSelfTickets, ticketQueryKeys } from './api'
import { useTicketsColumns } from './components/ticket-columns'
import { TicketCreateDialog } from './components/ticket-create-dialog'
import { TicketDataTable } from './components/ticket-data-table'
import { TicketDetailSheet } from './components/ticket-detail-sheet'
import { TicketFiltersBar } from './components/ticket-filters-bar'
import type { AdminTicketFilters } from './types'

const route = getRouteApi('/_authenticated/tickets/')

const EMPTY_FILTERS: AdminTicketFilters = {
  status: '',
  type: '',
  keyword: '',
  user: '',
}

/**
 * 用户端「工单反馈」页面：筛选工具栏 + 我的工单表格 + 新增弹窗 + 详情抽屉。
 * 表格复用管理端的 DataTablePage 结构，保持固定表头、表格内滚动与通用分页一致。
 */
export function TicketFeedback() {
  const { t } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const [createOpen, setCreateOpen] = useState(false)

  // 「新增工单」入口用管理员级开关判定，与服务端 TicketWriteEnabled 同源；
  // 不叠加用户个人收窄层，避免个人隐藏侧边栏的用户被误禁新增
  const canCreate = useIsAdminSidebarModuleVisible('/tickets')

  const { pagination, onPaginationChange, ensurePageInRange } =
    useTableUrlState({
      search,
      navigate,
      pagination: { defaultPage: 1, defaultPageSize: 10 },
      globalFilter: { enabled: false },
    })

  const [filters, setFilters] = useState<AdminTicketFilters>(() => ({
    ...EMPTY_FILTERS,
    status: search.status ? String(search.status) : '',
    type: search.type ? String(search.type) : '',
  }))

  const listQuery = useQuery({
    queryKey: [
      ...ticketQueryKeys.list,
      pagination.pageIndex + 1,
      pagination.pageSize,
      filters.status,
      filters.type,
    ],
    queryFn: () =>
      getSelfTickets({
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
        status: filters.status || undefined,
        type: filters.type || undefined,
      }),
    placeholderData: (previousData) => previousData,
  })

  const handleOpenTicket = useCallback(
    (id: number) => {
      void navigate({
        search: (prev) => ({ ...prev, ticket: id }),
      })
    },
    [navigate]
  )

  const columns = useTicketsColumns({
    scope: 'self',
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
    ticket?: number
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
    })
  }

  const handleReset = () => {
    setFilters(EMPTY_FILTERS)
    patchSearch({ page: 1, status: undefined, type: undefined })
  }

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Ticket Feedback')}</SectionPageLayout.Title>
      {canCreate ? (
        <SectionPageLayout.Actions>
          <Button size='sm' onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden='true' />
            {t('New Ticket')}
          </Button>
        </SectionPageLayout.Actions>
      ) : null}
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 flex-col gap-4'>
          <div className='min-h-0 flex-1'>
            <TicketDataTable
              table={table}
              columns={columns}
              toolbar={
                <TicketFiltersBar
                  scope='self'
                  table={table}
                  fetching={listQuery.isFetching}
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
                'Submit your first ticket and we will get back to you.'
              )}
              emptyAction={
                canCreate ? (
                  <Button type='button' onClick={() => setCreateOpen(true)}>
                    {t('New Ticket')}
                  </Button>
                ) : undefined
              }
              skeletonKeyPrefix='self-ticket-skeleton'
            />
          </div>

          <TicketDetailSheet
            open={search.ticket !== undefined}
            onOpenChange={(open) => {
              if (!open) patchSearch({ ticket: undefined })
            }}
            ticketId={search.ticket ?? null}
          />
          <TicketCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
