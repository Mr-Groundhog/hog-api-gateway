/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the License.
*/

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { toIntlLocale } from '@/i18n/languages'

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { formatQuota } from '@/lib/format'

import { getMyLotteryRecords, type LotteryUserDraw } from '../api'
import { lotteryQueryKeys } from '../constants'
import type { LotteryRecord } from '../types'

type RecordsPanelProps = {
  records: LotteryRecord[]
  loading: boolean
  error: boolean
  rank: number | null
}

type TabKey = 'all' | 'history'

function formatRecordTime(lang: string, iso: string, withDate: boolean) {
  const options: Intl.DateTimeFormatOptions = withDate
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' }
  return new Intl.DateTimeFormat(toIntlLocale(lang), options).format(
    new Date(iso)
  )
}

function HistoryRow({ record, lang }: { record: LotteryUserDraw; lang: string }) {
  return (
    <div className='lottery-record-row'>
      <span className='lottery-record-prize'>
        <strong>{record.prizeName}</strong>
        <small>
          {record.quotaAmount > 0
            ? formatQuota(record.quotaAmount)
            : record.prizeLabel}
        </small>
      </span>
      <span className='lottery-record-time'>
        {formatRecordTime(lang, record.createdAt, true)}
      </span>
    </div>
  )
}

export function RecordsPanel(props: RecordsPanelProps) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabKey>('all')

  const historyQuery = useQuery({
    queryKey: lotteryQueryKeys.myRecords,
    queryFn: getMyLotteryRecords,
    enabled: tab === 'history',
    retry: false,
  })

  // Refresh the visible list every time the user switches tabs, instead of
  // polling automatically.
  const handleTabChange = (next: TabKey) => {
    setTab(next)
    queryClient.invalidateQueries({ queryKey: lotteryQueryKeys.records })
    queryClient.invalidateQueries({ queryKey: lotteryQueryKeys.myRecords })
  }

  return (
    <aside className='lottery-records' aria-labelledby='lottery-records-title'>
      <div className='lottery-records-tabs' role='tablist'>
        <button
          type='button'
          role='tab'
          aria-selected={tab === 'all'}
          className={cn('lottery-records-tab', tab === 'all' && 'is-active')}
          onClick={() => handleTabChange('all')}
        >
          {t('All winners')}
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={tab === 'history'}
          className={cn(
            'lottery-records-tab',
            tab === 'history' && 'is-active'
          )}
          onClick={() => handleTabChange('history')}
        >
          {t('My history')}
        </button>
      </div>

      <div className='lottery-record-list' aria-live='polite'>
        {tab === 'all' ? (
          <>
            {props.loading &&
              Array.from({ length: 4 }, (_, index) => (
                <div className='lottery-record-skeleton' key={index}>
                  <Skeleton className='size-8 rounded-full' />
                  <div>
                    <Skeleton className='h-3 w-20' />
                    <Skeleton className='mt-2 h-2.5 w-14' />
                  </div>
                  <Skeleton className='ms-auto h-3 w-16' />
                </div>
              ))}
            {!props.loading && (props.error || props.records.length === 0) && (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <HugeiconsIcon icon={Clock01Icon} />
                  </EmptyMedia>
                  <EmptyTitle>
                    {props.error
                      ? t('Could not load draw records')
                      : t('No winners yet today')}
                  </EmptyTitle>
                  <EmptyDescription>
                    {props.error
                      ? t('The records will refresh automatically.')
                      : t('Winners will appear here as they draw.')}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {!props.loading &&
              props.records.map((record) => (
                <div className='lottery-record-row' key={record.id}>
                  <span className='lottery-record-avatar'>
                    {record.displayName.slice(0, 1)}
                  </span>
                  <span className='lottery-record-person'>
                    <strong>{record.displayName}</strong>
                    <small>
                      {formatRecordTime(
                        i18n.language,
                        record.createdAt,
                        false
                      )}
                    </small>
                  </span>
                  <span className='lottery-record-prize'>
                    <strong>{record.prizeName}</strong>
                    <small>
                      {record.prizeLabel}
                      {record.quotaAmount > 0
                        ? ` ${formatQuota(record.quotaAmount)}`
                        : ''}
                    </small>
                  </span>
                </div>
              ))}
          </>
        ) : (
          <>
            {historyQuery.isLoading &&
              Array.from({ length: 4 }, (_, index) => (
                <div className='lottery-record-skeleton' key={index}>
                  <div>
                    <Skeleton className='h-3 w-24' />
                    <Skeleton className='mt-2 h-2.5 w-16' />
                  </div>
                  <Skeleton className='ms-auto h-3 w-14' />
                </div>
              ))}
            {!historyQuery.isLoading &&
              (historyQuery.isError ||
                (historyQuery.data ?? []).length === 0) && (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant='icon'>
                      <HugeiconsIcon icon={Clock01Icon} />
                    </EmptyMedia>
                    <EmptyTitle>
                      {historyQuery.isError
                        ? t('Could not load your history')
                        : t('No draws yet')}
                    </EmptyTitle>
                    <EmptyDescription>
                      {t('Your draw history will appear here.')}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            {!historyQuery.isLoading &&
              (historyQuery.data ?? []).map((record, index) => (
                <HistoryRow
                  key={index}
                  record={record}
                  lang={i18n.language}
                />
              ))}
          </>
        )}
      </div>

      <footer>
        <span>
          {props.rank != null
            ? t('Your rank: #{{rank}}', { rank: props.rank })
            : t('Your rank')}
        </span>
      </footer>
    </aside>
  )
}
