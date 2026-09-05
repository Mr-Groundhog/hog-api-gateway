/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { useDataTable } from '@/components/data-table'

import { useTicketsColumns } from '../components/ticket-columns'
import { TicketDataTable } from '../components/ticket-data-table'
import { TICKET_STATUS, type TicketListItem } from '../types'

const baseItem: TicketListItem = {
  id: 12,
  userId: 1,
  username: '',
  type: 1,
  title: 'API 报错 429 一直重试',
  status: TICKET_STATUS.REPLIED,
  messageCount: 2,
  unreadReply: false,
  lastReplyTime: 1757000000,
  createdTime: 1756900000,
}

function SelfTicketTableHarness(props: {
  items: TicketListItem[]
  onOpenTicket: (id: number) => void
}) {
  const columns = useTicketsColumns({
    scope: 'self',
    onOpenTicket: props.onOpenTicket,
  })
  const { table } = useDataTable({
    data: props.items,
    columns,
    columnFilters: [],
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
      emptyDescription='Submit your first ticket and we will get back to you.'
      skeletonKeyPrefix='self-ticket-skeleton'
    />
  )
}

function renderList(items: TicketListItem[], onOpenTicket = vi.fn()) {
  return render(
    <SelfTicketTableHarness items={items} onOpenTicket={onOpenTicket} />
  )
}

describe('self ticket table', () => {
  test('empty state shows guidance copy', () => {
    renderList([])

    expect(screen.getByText('No tickets yet')).toBeInTheDocument()
    expect(
      screen.getByText('Submit your first ticket and we will get back to you.')
    ).toBeInTheDocument()
  })

  test('only unread rows carry the unread badge', () => {
    renderList([
      baseItem,
      { ...baseItem, id: 13, title: 'Second ticket', unreadReply: true },
    ])

    expect(screen.getAllByText('Unread')).toHaveLength(1)
    expect(screen.getByText('Second ticket')).toBeInTheDocument()
  })

  test('the unread badge disappears once the reply has been read', () => {
    renderList([{ ...baseItem, unreadReply: false }])

    expect(screen.queryByText('Unread')).toBeNull()
  })

  test('unread rows use a badge instead of a tinted background', () => {
    renderList([{ ...baseItem, unreadReply: true }])

    const row = screen.getByText('API 报错 429 一直重试').closest('tr')
    expect(row).not.toHaveClass('bg-warning/5')
    expect(
      screen.getByText('Unread').closest('[data-slot=status-badge]')
    ).toHaveClass('bg-destructive/10')
  })

  test('clicking a row opens that ticket', () => {
    const onOpenTicket = vi.fn()
    renderList([{ ...baseItem, unreadReply: true }], onOpenTicket)

    fireEvent.click(screen.getByText('API 报错 429 一直重试'))
    expect(onOpenTicket).toHaveBeenCalledWith(12)
  })
})
