/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import type { Table as TanstackTable } from '@tanstack/react-table'
import { RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTableToolbar } from '@/components/data-table'
import { DatePicker } from '@/components/date-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import {
  TICKET_STATUSES,
  TICKET_TYPES,
  getTicketStatusOptions,
  getTicketTypeOptions,
} from '../constants'
import type { AdminTicketFilters, TicketListItem, TicketStats } from '../types'
import type { TicketColumnsScope } from './ticket-columns'

type TicketFiltersBarProps = {
  scope: TicketColumnsScope
  table: TanstackTable<TicketListItem>
  fetching: boolean
  stats?: TicketStats
  statsLoading?: boolean
  onSearch: (filters: AdminTicketFilters) => void
  onRefresh: () => void
  onReset: () => void
}

export function TicketFiltersBar(props: TicketFiltersBarProps) {
  const { t } = useTranslation()
  const [user, setUser] = useState('')
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('all')
  const [startDate, setStartDate] = useState<Date>()
  const [endDate, setEndDate] = useState<Date>()

  const hasActiveFilters =
    (props.scope === 'admin' && (!!user.trim() || !!keyword.trim())) ||
    status !== 'all' ||
    type !== 'all' ||
    (props.scope === 'admin' && (!!startDate || !!endDate))

  const handleSearch = () => {
    const next: AdminTicketFilters = {
      status: status === 'all' ? '' : status,
      type: type === 'all' ? '' : type,
      keyword: props.scope === 'admin' ? keyword.trim() : '',
      user: props.scope === 'admin' ? user.trim() : '',
    }
    if (props.scope === 'admin' && startDate) {
      const start = new Date(startDate)
      start.setHours(0, 0, 0, 0)
      next.startTime = Math.floor(start.getTime() / 1000)
    }
    if (props.scope === 'admin' && endDate) {
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999)
      next.endTime = Math.floor(end.getTime() / 1000)
    }
    props.onSearch(next)
  }

  const handleReset = () => {
    setUser('')
    setKeyword('')
    setStatus('all')
    setType('all')
    setStartDate(undefined)
    setEndDate(undefined)
    props.onReset()
  }

  const selectedStatus =
    status === 'all' ? undefined : TICKET_STATUSES[Number(status)]
  const selectedType = type === 'all' ? undefined : TICKET_TYPES[Number(type)]

  const statusFilter = (
    <Select
      value={status}
      onValueChange={(value) => {
        if (value !== null) setStatus(value)
      }}
    >
      <SelectTrigger aria-label={t('Status')} className='sm:w-[136px]'>
        <SelectValue>
          {selectedStatus ? t(selectedStatus.labelKey) : t('All Statuses')}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value='all'>{t('All Statuses')}</SelectItem>
        {getTicketStatusOptions(t).map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
  const typeFilter = (
    <Select
      value={type}
      onValueChange={(value) => {
        if (value !== null) setType(value)
      }}
    >
      <SelectTrigger aria-label={t('Type')} className='sm:w-[136px]'>
        <SelectValue>
          {selectedType ? t(selectedType.labelKey) : t('All Ticket Types')}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value='all'>{t('All Ticket Types')}</SelectItem>
        {getTicketTypeOptions(t).map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  let stats: ReactNode | undefined
  if (props.scope === 'admin') {
    if (props.statsLoading) {
      stats = (
        <div className='flex items-center gap-2'>
          <Skeleton className='h-7 w-[112px] rounded-md' />
          <Skeleton className='h-7 w-[96px] rounded-md' />
          <Skeleton className='h-7 w-[104px] rounded-md' />
          <Skeleton className='h-7 w-[88px] rounded-md' />
        </div>
      )
    } else {
      stats = (
        <div className='flex flex-wrap items-center gap-2'>
          {[
            {
              label: t('Awaiting Reply'),
              value: props.stats?.pending ?? 0,
              accent: 'bg-amber-500/70',
            },
            {
              label: t('Replied'),
              value: props.stats?.replied ?? 0,
              accent: 'bg-emerald-500/70',
            },
            {
              label: t('Closed'),
              value: props.stats?.closed ?? 0,
              accent: 'bg-slate-400/70',
            },
            {
              label: t('Total'),
              value: props.stats?.total ?? 0,
              accent: 'bg-sky-500/70',
            },
          ].map((stat) => (
            <span
              key={stat.label}
              className='border-border/60 bg-muted/25 inline-flex h-7 items-center gap-2 rounded-md border px-2.5 text-xs shadow-xs'
            >
              <span className={cn('h-3.5 w-0.5 rounded-full', stat.accent)} />
              <span className='text-muted-foreground'>{stat.label}</span>
              <span className='text-foreground/85 font-mono font-semibold tabular-nums'>
                {stat.value}
              </span>
            </span>
          ))}
        </div>
      )
    }
  }

  return (
    <DataTableToolbar
      table={props.table}
      className='bg-card/50 rounded-lg border p-2.5 sm:p-3'
      customSearch={
        props.scope === 'admin' ? (
          <Input
            aria-label={t('User')}
            value={user}
            onChange={(event) => setUser(event.target.value)}
            placeholder={t('Filter by user ID or username')}
            onKeyDown={(event) => event.key === 'Enter' && handleSearch()}
            className='sm:w-[180px]'
          />
        ) : (
          statusFilter
        )
      }
      additionalSearch={
        props.scope === 'admin' ? (
          <>
            <Input
              aria-label={t('Keyword')}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t('Search title or username')}
              onKeyDown={(event) => event.key === 'Enter' && handleSearch()}
              className='sm:w-[190px]'
            />
            {statusFilter}
            {typeFilter}
            <div className='w-full sm:w-[150px] [&_button]:w-full'>
              <DatePicker
                selected={startDate}
                onSelect={setStartDate}
                placeholder={t('Start Time')}
              />
            </div>
            <div className='w-full sm:w-[150px] [&_button]:w-full'>
              <DatePicker
                selected={endDate}
                onSelect={setEndDate}
                placeholder={t('End Time')}
              />
            </div>
          </>
        ) : (
          typeFilter
        )
      }
      hasAdditionalFilters={hasActiveFilters}
      leftActions={stats}
      preActions={
        <Button
          type='button'
          variant='ghost'
          size='icon'
          onClick={props.onRefresh}
          disabled={props.fetching}
          aria-label={t('Refresh')}
        >
          <RefreshCw className={props.fetching ? 'animate-spin' : undefined} />
        </Button>
      }
      onSearch={handleSearch}
      searchLoading={props.fetching}
      onReset={handleReset}
    />
  )
}
