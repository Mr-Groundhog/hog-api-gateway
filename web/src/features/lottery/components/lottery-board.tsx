/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the License.
*/

import { SparklesIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

import type { LotteryPrize } from '../types'

type LotteryBoardProps = {
  prizes: LotteryPrize[]
  activeIndex: number | null
  running: boolean
  drawn: boolean
  remaining: number
  onDraw: () => void
}

export function LotteryBoard(props: LotteryBoardProps) {
  const { t } = useTranslation()
  let buttonLabel = t('Start draw')
  if (props.running) {
    buttonLabel = t('Drawing')
  } else if (props.drawn || props.remaining <= 0) {
    buttonLabel = t('Draw completed')
  }

  const noRemaining = props.drawn || props.remaining <= 0

  // The board always renders exactly 8 outer cells. If the admin disabled or
  // deleted a prize, that slot falls back to a "Thanks for joining" placeholder
  // so the nine-grid layout never shows a gap.
  const placeholder: LotteryPrize = {
    code: '__placeholder__',
    name: t('Thanks for joining'),
    label: t('Better luck next time'),
    icon: '--',
    tone: 'muted',
    quotaAmount: 0,
    sortOrder: -1,
  }
  const cells: LotteryPrize[] = Array.from({ length: 8 }, (_, i) => {
    const prize = props.prizes.find((p) => p.sortOrder === i + 1)
    return prize ?? placeholder
  })

  return (
    <div className='lottery-board-frame'>
      <span className='lottery-corner lottery-corner-nw'>09</span>
      <span className='lottery-corner lottery-corner-ne'>{t('Luck')}</span>
      <div
        className='lottery-board'
        aria-label={t('Mystery nine-grid lottery board')}
      >
        {cells.map((prize, index) => (
          <div
            key={`${prize.code}-${index}`}
            className={cn(
              'lottery-prize-cell',
              `lottery-tone-${prize.tone}`,
              props.activeIndex === index && 'is-active'
            )}
          >
            <span className='lottery-cell-index'>0{index + 1}</span>
            <strong>{prize.name}</strong>
            <small>{prize.label}</small>
          </div>
        ))}
        <button
          type='button'
          className='lottery-board-center'
          onClick={props.onDraw}
          disabled={props.running || noRemaining}
        >
          <HugeiconsIcon icon={SparklesIcon} aria-hidden='true' />
          {props.running && <Spinner aria-hidden='true' />}
          <span>{buttonLabel}</span>
          <small>
            {noRemaining
              ? t('No draws left today')
              : props.running
                ? t('Please wait')
                : t('Remaining draws: {{count}}', {
                    count: props.remaining,
                  })}
          </small>
        </button>
      </div>
      <span className='lottery-corner lottery-corner-sw'>{t('Draw')}</span>
      <span className='lottery-corner lottery-corner-se'>*</span>
    </div>
  )
}
