/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { useQuery } from '@tanstack/react-query'
import { Trophy } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { getPlayerRankings, RANKING_QUERY_KEY } from './api'

export const PlayerLeaderboard = memo(function PlayerLeaderboard() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const query = useQuery({
    queryKey: RANKING_QUERY_KEY,
    queryFn: ({ signal }) => getPlayerRankings(signal),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    meta: { errorToast: false },
  })

  return (
    <aside
      aria-label={t('Player rankings')}
      className='bg-card flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border'
    >
      <header className='flex shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-2.5 sm:px-3'>
        <Trophy className='size-4 shrink-0 text-amber-500' aria-hidden='true' />
        <h3 className='text-xs font-semibold sm:text-sm'>
          {t('Player rankings')}
        </h3>
        <span className='text-muted-foreground text-[10px]'>{t('Top 50')}</span>
      </header>
      <div className='min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto overscroll-contain'>
        {query.isPending && <LoadingState size='sm' className='min-h-0 py-4' />}
        {query.isError && (
          <ErrorState
            title={t('Failed to load player rankings')}
            description={getServerErrorMessage(query.error)}
            onRetry={() => {
              void query.refetch()
            }}
            className='min-h-0 px-2 py-4'
          />
        )}
        {query.isSuccess && query.data.length === 0 && (
          <EmptyState
            icon={Trophy}
            title={t('No scores yet')}
            className='min-h-0 px-2 py-4'
          />
        )}
        {query.isSuccess && query.data.length > 0 && (
          <ol className='divide-y'>
            {query.data.map((player, index) => (
              <li
                key={player.round_id}
                className='flex min-w-0 items-start gap-1.5 px-2 py-2.5 text-xs sm:gap-2 sm:px-3'
              >
                <span className='text-muted-foreground w-4 shrink-0 pt-0.5 font-bold tabular-nums'>
                  {formatNumber(index + 1, locale)}
                </span>
                <div className='min-w-0 flex-1'>
                  <p
                    className='truncate font-medium'
                    title={player.display_name}
                  >
                    {player.display_name}
                  </p>
                  <p className='mt-1 font-semibold tabular-nums'>
                    {t('{{score}} points', {
                      score: formatNumber(player.score, locale),
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  )
})
