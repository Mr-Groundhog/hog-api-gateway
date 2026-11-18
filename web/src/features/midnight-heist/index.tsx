/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { Expand, Gamepad2 } from 'lucide-react'
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout/components/section-page-layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { GAME_HEIGHT, GAME_WIDTH, MAX_SCORE } from './game'
import { fitCoinCaptureBoard } from './layout'
import { PlayerLeaderboard } from './leaderboard'
import { useHeistGame } from './use-heist-game'

export function CoinCaptureOperation() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const game = useHeistGame()
  const viewportRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 900, height: 600 })

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    function measure(): void {
      if (!viewport) return
      const bounds = viewport.getBoundingClientRect()
      setSize((previous) =>
        previous.width === bounds.width && previous.height === bounds.height
          ? previous
          : { width: bounds.width, height: bounds.height }
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const layout = fitCoinCaptureBoard(size.width, size.height)
  const snapshot = game.snapshot
  const compact = layout.gameWidth < 480
  let alertStatus = t('Safe')
  if (snapshot.status === 'caught') alertStatus = t('Caught')
  else if (snapshot.status === 'smoke') alertStatus = t('Smoke active')
  else if (snapshot.status === 'magnet') alertStatus = t('Magnet active')
  let overlayTitle = t('Coin Capture Operation')
  let overlayMessage = t(
    'Collect coins, build combos and avoid patrol lights. Magnets, smoke and multiplier gems activate automatically.'
  )
  if (snapshot.mode === 'over') {
    overlayTitle = t('Action complete')
    overlayMessage = t('Quota has been added to your account')
  } else if (snapshot.mode === 'settling') {
    overlayTitle = t('Settling reward')
    overlayMessage = t('Your score and quota are being confirmed')
  }

  function movePointer(event: PointerEvent<HTMLCanvasElement>): void {
    if (snapshot.mode !== 'playing') return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    game.moveTo(
      ((event.clientX - bounds.left) * GAME_WIDTH) / bounds.width,
      ((event.clientY - bounds.top) * GAME_HEIGHT) / bounds.height
    )
  }

  function moveKeyboard(event: KeyboardEvent<HTMLCanvasElement>): void {
    if (snapshot.mode !== 'playing') return
    let dx = 0
    let dy = 0
    switch (event.key.toLowerCase()) {
      case 'arrowleft':
      case 'a':
        dx = -60
        break
      case 'arrowright':
      case 'd':
        dx = 60
        break
      case 'arrowup':
      case 'w':
        dy = -60
        break
      case 'arrowdown':
      case 's':
        dy = 60
        break
      default:
        return
    }
    event.preventDefault()
    game.moveBy(dx, dy)
  }

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        <span className='inline-flex items-center gap-2'>
          <Gamepad2 className='size-5' aria-hidden='true' />
          {t('Coin Capture Operation')}
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => {
            const viewport = viewportRef.current
            if (!viewport) return
            if (document.fullscreenElement) {
              void document
                .exitFullscreen()
                .catch((error: unknown) => handleServerError(error))
              return
            }
            void viewport
              .requestFullscreen()
              .catch((error: unknown) => handleServerError(error))
          }}
        >
          <Expand className='size-4' aria-hidden='true' />
          {t('Fullscreen')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div
          ref={viewportRef}
          className='bg-background flex h-full min-h-0 w-full items-center justify-center overflow-hidden'
        >
          <div
            className='grid max-h-full min-h-0 max-w-full items-stretch'
            style={{
              gridTemplateColumns: `${layout.gameWidth}px ${layout.rankingWidth}px`,
              gap: layout.gap,
              height: layout.height,
            }}
          >
            <section
              aria-label={t('Game arena')}
              className='flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden rounded-xl border border-[#58614a] bg-[#17211e] p-2 text-[#eaf2ea]'
            >
              <dl className='grid shrink-0 grid-cols-4 gap-1.5'>
                <div className='min-w-0 rounded-md bg-[#222820] px-1.5 py-1'>
                  <dt className='truncate text-[9px] text-[#aebdb2]'>
                    {t('Round score')}
                  </dt>
                  <dd className='truncate text-lg font-black text-[#f1cb73] tabular-nums'>
                    {formatNumber(snapshot.score, locale)}
                  </dd>
                </div>
                <div className='min-w-0 rounded-md bg-[#222820] px-1.5 py-1'>
                  <dt className='truncate text-[9px] text-[#aebdb2]'>
                    {t('Time remaining')}
                  </dt>
                  <dd
                    className={
                      snapshot.seconds <= 10 && snapshot.mode === 'playing'
                        ? 'animate-pulse truncate text-lg font-black text-[#ee8283] tabular-nums'
                        : 'truncate text-lg font-black tabular-nums'
                    }
                  >
                    {formatNumber(snapshot.seconds, locale)}
                  </dd>
                </div>
                <div className='min-w-0 rounded-md bg-[#222820] px-1.5 py-1'>
                  <dt className='truncate text-[9px] text-[#aebdb2]'>
                    {t('Combo multiplier')}
                  </dt>
                  <dd className='truncate text-lg font-black text-[#8ce0bb] tabular-nums'>
                    ×{formatNumber(snapshot.multiplier, locale)}
                  </dd>
                </div>
                <div className='min-w-0 rounded-md bg-[#222820] px-1.5 py-1'>
                  <dt className='truncate text-[9px] text-[#aebdb2]'>
                    {t('Alert status')}
                  </dt>
                  <dd className='truncate text-lg font-black text-[#f1cb73] tabular-nums'>
                    {alertStatus}
                  </dd>
                </div>
              </dl>
              <div className='flex min-h-0 flex-1 items-center justify-center'>
                <div className='relative max-h-full w-full overflow-hidden rounded-lg border border-[#58614a] bg-[#161e19]'>
                  {/* A spatial canvas control preserves the server's 900×540 coordinates at every display size. */}
                  <canvas
                    ref={game.canvasRef}
                    width={GAME_WIDTH}
                    height={GAME_HEIGHT}
                    tabIndex={snapshot.mode === 'playing' ? 0 : -1}
                    aria-label={t(
                      'Move with the mouse, touch, arrow keys or WASD. Collect coins and avoid patrols.'
                    )}
                    className='block aspect-[5/3] h-auto w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-[#f1cb73] focus-visible:ring-inset'
                    onPointerMove={movePointer}
                    onPointerEnter={movePointer}
                    onPointerDown={(event) => {
                      if (snapshot.mode !== 'playing') return
                      event.currentTarget.setPointerCapture(event.pointerId)
                      event.currentTarget.focus({ preventScroll: true })
                      movePointer(event)
                    }}
                    onKeyDown={moveKeyboard}
                  />
                  {snapshot.mode !== 'playing' && (
                    <div className='absolute inset-0 grid place-items-center overflow-y-auto bg-[#111813e6] p-2 text-center backdrop-blur-sm'>
                      <div className='flex max-h-full w-full max-w-md flex-col items-center gap-2 overflow-y-auto py-1'>
                        {game.loading ? (
                          <LoadingState
                            inline
                            size='sm'
                            message={t('Loading...')}
                          />
                        ) : (
                          <>
                            <h3
                              className={
                                compact
                                  ? 'text-sm font-black'
                                  : 'text-2xl font-black'
                              }
                            >
                              {overlayTitle}
                            </h3>
                            {(snapshot.mode === 'over' ||
                              snapshot.mode === 'settling') && (
                              <p
                                role='status'
                                className='text-lg font-black text-[#f1cb73]'
                              >
                                {t('Final score: {{score}}', {
                                  score: formatNumber(snapshot.score, locale),
                                })}
                              </p>
                            )}
                            {game.error ? (
                              <ErrorState
                                title={
                                  snapshot.mode === 'settling'
                                    ? t(
                                        'Failed to settle the game; please retry'
                                      )
                                    : t('Failed to load the game')
                                }
                                description={getServerErrorMessage(game.error)}
                                onRetry={game.retry}
                                className='min-h-0 p-2'
                              />
                            ) : (
                              <>
                                {!compact && (
                                  <p className='text-sm leading-relaxed text-[#c8d2c8]'>
                                    {overlayMessage}
                                  </p>
                                )}
                                {snapshot.mode === 'over' && (
                                  <p className='text-sm text-[#8ce0bb]'>
                                    {t('Quota earned: {{amount}}', {
                                      amount: game.rewardAmount,
                                    })}
                                  </p>
                                )}
                                {snapshot.mode === 'ready' && (
                                  <Button
                                    type='button'
                                    size={compact ? 'sm' : 'lg'}
                                    className='bg-[#e8cd82] px-4 font-bold text-[#2a281a] hover:bg-[#f1db9b]'
                                    disabled={!game.available || game.starting}
                                    onClick={game.start}
                                  >
                                    {game.starting
                                      ? t('Starting...')
                                      : t('Start action')}
                                  </Button>
                                )}
                                {snapshot.mode === 'over' && (
                                  <p className='text-xs text-[#c8d2c8]'>
                                    {t(
                                      'Today’s game is complete. Come back tomorrow.'
                                    )}
                                  </p>
                                )}
                                {snapshot.mode === 'settling' && (
                                  <LoadingState inline size='sm' />
                                )}
                                {!game.available && (
                                  <p className='text-xs'>
                                    {t(
                                      'Canvas is unavailable in this browser.'
                                    )}
                                  </p>
                                )}
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <footer className='flex shrink-0 flex-col gap-0.5 overflow-hidden text-[10px] leading-tight text-[#aebdb2]'>
                <span className='truncate'>
                  {t('40 seconds · Once daily · Max {{score}} points', {
                    score: MAX_SCORE,
                  })}
                </span>
                <span className='truncate'>
                  {t('Mouse / touch / arrow keys / WASD')}
                </span>
              </footer>
            </section>
            <PlayerLeaderboard />
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
