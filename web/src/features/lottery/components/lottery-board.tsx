/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the License.
*/

import { SparklesIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

import type { LotteryPrize } from '../types'

const BOARD_POSITIONS = [
  'top-left',
  'top',
  'top-right',
  'left',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
] as const

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
    buttonLabel = t('Drawing in progress')
  } else if (props.drawn || props.remaining <= 0) {
    buttonLabel = t('Draw completed')
  }

  const noRemaining = props.drawn || props.remaining <= 0
  let drawHint = t('Remaining draws: {{count}}', { count: props.remaining })
  if (noRemaining) {
    drawHint = t('No draws left today')
  } else if (props.running) {
    drawHint = t('Please wait')
  }

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
  const cells = BOARD_POSITIONS.map((position, i) => {
    const prize = props.prizes.find((p) => p.sortOrder === i + 1)
    return { position, prize: prize ?? placeholder }
  })

  return (
    <div className='lottery-board-frame'>
      <div
        className='lottery-board'
        aria-label={t('Mystery nine-grid lottery board')}
      >
        {cells.map(({ position, prize }, index) => (
          <div
            key={position}
            className={cn(
              'lottery-prize-cell',
              `lottery-tone-${prize.tone}`,
              props.activeIndex === index && 'is-active'
            )}
          >
            <span className='lottery-cell-index' aria-hidden='true'>
              0{index + 1}
            </span>
            <span className='lottery-prize-icon' aria-hidden='true'>
              {prize.icon}
            </span>
            <strong>{prize.name}</strong>
            <small>{prize.label}</small>
          </div>
        ))}
        <Button
          type='button'
          className='lottery-board-center h-auto flex-col whitespace-normal'
          onClick={props.onDraw}
          disabled={props.running || noRemaining}
          data-running={props.running || undefined}
        >
          {props.running ? (
            <Spinner className='size-6' aria-hidden='true' />
          ) : (
            <HugeiconsIcon
              icon={SparklesIcon}
              className='size-6'
              aria-hidden='true'
            />
          )}
          <span>{buttonLabel}</span>
          <small>{drawHint}</small>
        </Button>
      </div>
    </div>
  )
}
