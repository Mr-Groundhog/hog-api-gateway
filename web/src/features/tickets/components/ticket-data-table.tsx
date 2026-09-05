/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import type { ColumnDef, Table as TanstackTable } from '@tanstack/react-table'
import type { ReactNode } from 'react'

import { DataTablePage, DataTableRow } from '@/components/data-table'

import type { TicketListItem } from '../types'

type TicketDataTableProps = {
  table: TanstackTable<TicketListItem>
  columns: ColumnDef<TicketListItem, unknown>[]
  toolbar: ReactNode
  isLoading: boolean
  isFetching: boolean
  onOpenTicket: (id: number) => void
  emptyTitle: string
  emptyDescription: string
  emptyAction?: ReactNode
  skeletonKeyPrefix: string
}

export function TicketDataTable(props: TicketDataTableProps) {
  return (
    <DataTablePage
      table={props.table}
      columns={props.columns}
      toolbar={props.toolbar}
      isLoading={props.isLoading}
      isFetching={props.isFetching}
      emptyTitle={props.emptyTitle}
      emptyDescription={props.emptyDescription}
      emptyAction={props.emptyAction}
      skeletonKeyPrefix={props.skeletonKeyPrefix}
      applyHeaderSize
      renderRow={(row, { getCellClassName }) => (
        <DataTableRow
          key={row.id}
          row={row}
          className='hover:bg-muted/50 cursor-pointer'
          getColumnClassName={getCellClassName}
          onClick={() => props.onOpenTicket(row.original.id)}
        />
      )}
    />
  )
}
