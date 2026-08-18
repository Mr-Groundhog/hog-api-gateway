/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the License.
*/

import { InformationCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'

import {
  drawLottery,
  getLotteryConfig,
  getLotteryStatus,
  getTodayLotteryRecords,
} from './api'
import { LotteryBoard } from './components/lottery-board'
import { RecordsPanel } from './components/records-panel'
import { ResultDialog } from './components/result-dialog'

import { formatQuota } from '@/lib/format'

import { lotteryQueryKeys } from './constants'
import { getLotteryErrorKey, getLotteryStepDelay } from './lib'
import type { LotteryDrawResult } from './types'

import './lottery.css'

function wait(duration: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, duration))
}

export function Lottery() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const drawRequestActive = useRef(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [result, setResult] = useState<LotteryDrawResult | null>(null)
  const [noticeKey, setNoticeKey] = useState(
    'Ready when you are. Your luck is waiting.'
  )
  const [drawn, setDrawn] = useState(false)

  const statusQuery = useQuery({
    queryKey: lotteryQueryKeys.status,
    queryFn: getLotteryStatus,
    retry: false,
  })
  const remaining = statusQuery.data?.remaining ?? 0
  const myDraw = statusQuery.data?.my_draw ?? null

  const prizesQuery = useQuery({
    queryKey: lotteryQueryKeys.prizes,
    queryFn: getLotteryConfig,
    retry: false,
  })
  const prizes = prizesQuery.data ?? []
  const lotteryPath = useMemo(
    () => Array.from({ length: Math.max(prizes.length, 1) }, (_, i) => i),
    [prizes.length]
  )

  const recordsQuery = useQuery({
    queryKey: lotteryQueryKeys.records,
    queryFn: getTodayLotteryRecords,
    retry: false,
  })
  const drawMutation = useMutation({
    mutationFn: drawLottery,
    onSuccess: async (serverResult) => {
      const winnerPosition = Math.max(
        0,
        Math.min(lotteryPath.length - 1, serverResult.boardIndex)
      )
      const reducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches
      if (!reducedMotion) {
        const totalSteps = lotteryPath.length * 4 + winnerPosition
        for (let step = 0; step <= totalSteps; step += 1) {
          setActiveIndex(lotteryPath[step % lotteryPath.length])
          await wait(getLotteryStepDelay(step / totalSteps))
        }
      }
      setActiveIndex(lotteryPath[winnerPosition])
      setResult(serverResult)
      setDrawn(true)
      setNoticeKey('This draw is complete. Come back tomorrow for another.')
      await queryClient.invalidateQueries({
        queryKey: lotteryQueryKeys.records,
      })
      await queryClient.invalidateQueries({
        queryKey: lotteryQueryKeys.status,
      })
    },
    onError: (error) => {
      const errorKey = getLotteryErrorKey(error)
      setNoticeKey(errorKey)
      if (errorKey === 'You have already drawn today. Come back tomorrow.') {
        setDrawn(true)
      }
    },
    onSettled: () => {
      drawRequestActive.current = false
    },
  })

  return (
    <PublicLayout showMainContainer={false}>
      <main className='lottery-page'>
        <PageTransition className='lottery-page-inner'>
          <div className='lottery-page-heading'>
            <div>
              <span className='lottery-kicker'>
                {t("Today's lucky stage")}
              </span>
              <h2 id='lottery-stage-title'>
                {t('Take your luck with you')}
              </h2>
            </div>
            <Badge
              variant={drawMutation.isPending ? 'default' : 'outline'}
            >
              {drawMutation.isPending
                ? t('Drawing')
                : myDraw
                  ? myDraw.quotaAmount > 0
                    ? t('Won {{name}} +{{amount}}', {
                        name: myDraw.prizeName,
                        amount: formatQuota(myDraw.quotaAmount),
                      })
                    : t('Won {{name}}', { name: myDraw.prizeName })
                  : t('Ready to draw')}
            </Badge>
          </div>
          <div className='lottery-workspace'>
            <section
              className='lottery-stage'
              aria-labelledby='lottery-stage-title'
            >
              <LotteryBoard
                prizes={prizes}
                activeIndex={activeIndex}
                running={drawMutation.isPending}
                drawn={drawn}
                remaining={remaining}
                onDraw={() => {
                  if (drawRequestActive.current || drawn || remaining <= 0) return
                  drawRequestActive.current = true
                  setResult(null)
                  setNoticeKey('The result is being sealed. Please wait.')
                  drawMutation.mutate()
                }}
              />
              <p className='lottery-notice' aria-live='polite'>
                <span aria-hidden='true' /> {t(noticeKey)}
              </p>
            </section>

            <div className='lottery-sidebar'>
              <RecordsPanel
                records={recordsQuery.data ?? []}
                loading={recordsQuery.isLoading}
                error={recordsQuery.isError}
                rank={statusQuery.data?.rank ?? null}
              />
              <Alert className='lottery-rules-note'>
                <HugeiconsIcon icon={InformationCircleIcon} />
                <AlertTitle>{t('How the draw works')}</AlertTitle>
                <AlertDescription>
                  {t(
                    'The server selects and records the result. The animation only reveals the result already chosen. Each user can draw once per day.'
                  )}
                </AlertDescription>
              </Alert>
            </div>
          </div>
        </PageTransition>
      </main>
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </PublicLayout>
  )
}
