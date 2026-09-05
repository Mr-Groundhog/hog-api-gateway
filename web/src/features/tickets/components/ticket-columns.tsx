/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import type { ColumnDef } from '@tanstack/react-table'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { formatTimestampToDate } from '@/lib/format'

import type { TicketListItem } from '../types'
import { TicketStatusBadge } from './ticket-status-badge'
import { TicketTypeLabel } from './ticket-type-label'

export type TicketColumnsScope = 'admin' | 'self'

type UseTicketColumnsProps = {
  scope: TicketColumnsScope
  onOpenTicket: (id: number) => void
}

export function useTicketsColumns({
  scope,
  onOpenTicket,
}: UseTicketColumnsProps): ColumnDef<TicketListItem, unknown>[] {
  const { t } = useTranslation()
  const columns: ColumnDef<TicketListItem, unknown>[] = []

  if (scope === 'admin') {
    columns.push(
      {
        accessorKey: 'id',
        header: t('ID'),
        cell: ({ row }) => (
          <span className='text-muted-foreground font-mono tabular-nums'>
            {row.original.id}
          </span>
        ),
        size: 72,
        meta: { mobileHidden: true },
      },
      {
        accessorKey: 'username',
        header: t('User'),
        cell: ({ row }) => (
          <span className='block truncate'>
            {row.original.username || `#${row.original.userId}`}
          </span>
        ),
        size: 140,
      }
    )
  }

  columns.push(
    {
      accessorKey: 'type',
      header: t('Type'),
      cell: ({ row }) => <TicketTypeLabel type={row.original.type} />,
      size: 124,
    },
    {
      accessorKey: 'title',
      header: t('Title'),
      cell: ({ row }) =>
        scope === 'self' && row.original.unreadReply ? (
          <div className='flex min-w-0 items-center gap-2'>
            <span className='truncate font-medium'>{row.original.title}</span>
            <StatusBadge
              variant='danger'
              label={t('Unread')}
              copyable={false}
              type='badge'
              className='bg-destructive/10 text-destructive ring-destructive/20 ring-1'
            />
          </div>
        ) : (
          <span className='block truncate font-medium'>
            {row.original.title}
          </span>
        ),
      size: 280,
      meta: { mobileTitle: true },
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      cell: ({ row }) => <TicketStatusBadge status={row.original.status} />,
      size: 132,
      meta: { mobileBadge: true },
    }
  )

  columns.push(
    {
      accessorKey: 'lastReplyTime',
      header: t('Last Update'),
      cell: ({ row }) => (
        <span className='text-muted-foreground whitespace-nowrap'>
          {formatTimestampToDate(row.original.lastReplyTime)}
        </span>
      ),
      size: 176,
      meta: { mobileHidden: true },
    },
    {
      id: 'actions',
      header: () => <span className='sr-only'>{t('Open')}</span>,
      cell: ({ row }) => (
        <Button
          type='button'
          variant='ghost'
          size='icon'
          aria-label={t('Open')}
          onClick={(event) => {
            event.stopPropagation()
            onOpenTicket(row.original.id)
          }}
        >
          <ChevronRight aria-hidden='true' />
        </Button>
      ),
      enableSorting: false,
      enableHiding: false,
      size: 56,
    }
  )

  return columns
}
