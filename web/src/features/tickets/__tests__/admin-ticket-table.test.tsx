import type { ColumnDef } from '@tanstack/react-table'
/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { useDataTable } from '@/components/data-table'

import { useTicketsColumns } from '../components/ticket-columns'
import { TicketDataTable } from '../components/ticket-data-table'
import { TicketFiltersBar } from '../components/ticket-filters-bar'
import {
  TICKET_STATUS,
  type AdminTicketFilters,
  type TicketListItem,
} from '../types'

const pendingItem: TicketListItem = {
  id: 128,
  userId: 1,
  username: 'alice',
  type: 1,
  title: 'API 报错 429 一直重试',
  status: TICKET_STATUS.PENDING,
  messageCount: 3,
  unreadReply: false,
  lastReplyTime: 1757000000,
  createdTime: 1756900000,
}

const repliedItem: TicketListItem = {
  ...pendingItem,
  id: 127,
  username: 'bob',
  title: '账单对不上',
  status: TICKET_STATUS.REPLIED,
  messageCount: 2,
}

function FiltersHarness(props: {
  onSearch: (filters: AdminTicketFilters) => void
  onReset: () => void
}) {
  const columns: ColumnDef<TicketListItem, unknown>[] = []
  const { table } = useDataTable({
    data: [],
    columns,
    columnFilters: [],
    enableRowSelection: false,
  })

  return (
    <TicketFiltersBar
      scope='admin'
      table={table}
      fetching={false}
      statsLoading={false}
      onSearch={props.onSearch}
      onRefresh={vi.fn()}
      onReset={props.onReset}
    />
  )
}

function renderFilters(onSearch = vi.fn(), onReset = vi.fn()) {
  return render(<FiltersHarness onSearch={onSearch} onReset={onReset} />)
}

function TableHarness(props: {
  items: TicketListItem[]
  onOpenTicket: (id: number) => void
}) {
  const columns = useTicketsColumns({
    scope: 'admin',
    onOpenTicket: props.onOpenTicket,
  })
  const { table } = useDataTable({
    data: props.items,
    columns,
    enableRowSelection: false,
  })

  return (
    <TicketDataTable
      table={table}
      columns={columns}
      toolbar={null}
      isLoading={false}
      isFetching={false}
      onOpenTicket={props.onOpenTicket}
      emptyTitle='No tickets yet'
      emptyDescription='Submitted tickets will appear here for admin review and replies.'
      skeletonKeyPrefix='admin-ticket-skeleton'
    />
  )
}

describe('admin ticket filters', () => {
  test('filter selects use explicit all-status and all-type labels', () => {
    renderFilters()

    const statusSelect = screen.getByRole('combobox', { name: 'Status' })
    const typeSelect = screen.getByRole('combobox', { name: 'Type' })
    expect(within(statusSelect).getByText('All Statuses')).toBeInTheDocument()
    expect(within(typeSelect).getByText('All Ticket Types')).toBeInTheDocument()
  })

  test('typing does not trigger a search until Search is clicked', () => {
    const onSearch = vi.fn()
    renderFilters(onSearch)

    fireEvent.change(screen.getByLabelText('Keyword'), {
      target: { value: '429' },
    })
    expect(onSearch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(onSearch).toHaveBeenCalledTimes(1)
    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: '429', status: '', type: '' })
    )
  })

  test('pressing Enter in the keyword field triggers exactly one search', () => {
    const onSearch = vi.fn()
    renderFilters(onSearch)

    const keyword = screen.getByLabelText('Keyword')
    fireEvent.change(keyword, { target: { value: 'bill' } })
    fireEvent.keyDown(keyword, { key: 'Enter' })

    expect(onSearch).toHaveBeenCalledTimes(1)
    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'bill' })
    )
  })

  test('reset clears the draft filters and calls onReset', () => {
    const onSearch = vi.fn()
    const onReset = vi.fn()
    renderFilters(onSearch, onReset)

    fireEvent.change(screen.getByLabelText('Keyword'), {
      target: { value: 'bill' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

    expect(onReset).toHaveBeenCalledTimes(1)
    expect(onSearch).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Keyword')).toHaveValue('')
  })
})

describe('admin ticket table', () => {
  test('renders rows in server order with pending highlighted first', () => {
    render(
      // 服务端默认排序 status ASC：待处理天然在最前
      <TableHarness
        items={[pendingItem, repliedItem]}
        onOpenTicket={() => {}}
      />
    )

    const titles = screen
      .getAllByText(/API 报错 429 一直重试|账单对不上/)
      .map((node) => node.textContent)
    expect(titles).toEqual(['API 报错 429 一直重试', '账单对不上'])
  })

  test('shows username without a message-count column or unread badges', () => {
    render(
      <TableHarness
        items={[pendingItem, repliedItem]}
        onOpenTicket={() => {}}
      />
    )

    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Messages' })).toBeNull()
    // 管理端没有已读语义：不渲染任何「管理员已回复」标记
    expect(screen.queryByText('Admin replied')).toBeNull()
  })

  test('marks pending tickets with a solid red status badge', () => {
    render(<TableHarness items={[pendingItem]} onOpenTicket={() => {}} />)

    const badge = screen
      .getByText('Awaiting Reply')
      .closest('[data-slot=status-badge]')
    expect(badge).toHaveClass('bg-destructive', 'text-white')
  })

  test('shows an empty-state row when there are no tickets', () => {
    render(<TableHarness items={[]} onOpenTicket={() => {}} />)

    expect(screen.getByText('No tickets yet')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Submitted tickets will appear here for admin review and replies.'
      )
    ).toBeInTheDocument()
  })
})

// 保证筛选类型对外契约稳定（用户列支持 ID 或用户名，交给后端解析）
describe('admin ticket filter contract', () => {
  test('user filter value is passed through verbatim', () => {
    const onSearch = vi.fn()
    renderFilters(onSearch)

    fireEvent.change(screen.getByLabelText('User'), {
      target: { value: '42' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    const filters: AdminTicketFilters = onSearch.mock.calls[0][0]
    expect(filters.user).toBe('42')
  })
})
