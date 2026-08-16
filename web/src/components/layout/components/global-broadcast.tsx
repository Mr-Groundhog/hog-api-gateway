/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Dialog } from '@/components/dialog'
import { useStatus } from '@/hooks/use-status'
import type { BroadcastItem } from '@/features/dashboard/types'
import type { SystemStatus } from '@/features/auth/types'

import { Radio, X } from 'lucide-react'

const badgeVariantMap = {
  default: 'neutral',
  ongoing: 'info',
  success: 'success',
  warning: 'warning',
  error: 'danger',
} as const

const dotColorMap = {
  default: 'bg-gray-400',
  ongoing: 'bg-blue-400',
  success: 'bg-green-400',
  warning: 'bg-orange-400',
  error: 'bg-red-400',
} as const

// How long each broadcast stays on screen before sliding to the next one.
const STAY_MS = 10000

// Read the latest status snapshot directly from localStorage. This hook keeps
// the in-memory react-query cache fresh, but we render from localStorage so the
// broadcast is always based on the most recently persisted payload.
function getBroadcastsFromStorage(): BroadcastItem[] {
  try {
    if (typeof window === 'undefined') return []
    const raw = window.localStorage.getItem('status')
    if (!raw) return []
    const status = JSON.parse(raw) as SystemStatus
    // Respect the broadcast_enabled switch: when it is explicitly false the
    // marquee must stay hidden regardless of any cached broadcast entries.
    if (status?.broadcast_enabled === false) return []
    return (status?.broadcasts ?? []) as BroadcastItem[]
  } catch {
    return []
  }
}

/**
 * A single broadcast line. If the text is wider than the row it scrolls
 * horizontally; otherwise it is shown statically.
 */
function BroadcastLine({
  item,
  onOpen,
}: {
  item: BroadcastItem
  onOpen: () => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [scroll, setScroll] = useState(false)
  const [duration, setDuration] = useState(8)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const text = textRef.current
    if (!viewport || !text) return
    const overflow = text.scrollWidth - viewport.clientWidth
    if (overflow > 0) {
      setScroll(true)
      // Roughly 30px per second so longer text gets more time.
      setDuration(Math.max(6, Math.ceil(overflow / 30)))
    } else {
      setScroll(false)
    }
  }, [item.content])

  return (
    <button
      type='button'
      onClick={onOpen}
      className='broadcast-slide-in flex h-7 w-full items-center gap-2 text-left'
    >
      <span
        className={`h-2 w-2 shrink-0 self-center rounded-full ${dotColorMap[item.type ?? 'default']}`}
      />
      <div ref={viewportRef} className='relative flex flex-1 items-center overflow-hidden'>
        <span
          ref={textRef}
          className={`inline-block whitespace-nowrap text-xs font-medium leading-none text-amber-900 dark:text-amber-100 ${
            scroll ? 'broadcast-text-scroll' : ''
          }`}
          style={
            scroll
              ? ({
                  ['--broadcast-viewport' as string]: `${viewportRef.current?.clientWidth ?? 0}px`,
                  ['--broadcast-scroll-duration' as string]: `${duration}s`,
                } as React.CSSProperties)
              : undefined
          }
        >
          {item.content}
        </span>
      </div>
    </button>
  )
}

/**
 * Global broadcast widget placed next to the logo in the header.
 *
 * Shows one broadcast at a time. If its text is wider than the row it scrolls
 * horizontally; when it finishes, the line slides up and the next broadcast
 * takes its place, cycling through all of them.
 *
 * Hidden when broadcast_enabled is false or there are no broadcasts.
 */
export function GlobalBroadcast() {
  const { t } = useTranslation()
  // Keep the cache warm / refresh localStorage in the background.
  useStatus()
  const broadcasts = getBroadcastsFromStorage()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  // Reset/advance the carousel only when there is more than one broadcast.
  useEffect(() => {
    if (broadcasts.length <= 1) {
      setActiveIndex(0)
      return
    }
    const timer = window.setInterval(() => {
      setActiveIndex((i) => (i + 1) % broadcasts.length)
    }, STAY_MS)
    return () => window.clearInterval(timer)
  }, [broadcasts.length, broadcasts])

  if (broadcasts.length === 0) return null

  const accent = dotColorMap[broadcasts[0]?.type ?? 'default']
  const active = broadcasts[activeIndex] ?? broadcasts[0]

  return (
    <>
      <div className='min-w-[320px] flex-1 rounded-full bg-gradient-to-r from-red-400 via-orange-400 to-yellow-400 p-[2px] shadow-sm transition hover:shadow-[0_0_10px_rgba(239,68,68,0.4)] dark:from-red-500 dark:via-orange-500 dark:to-yellow-500'>
        <div className='flex h-7 w-full items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-amber-50 to-orange-50 px-3 transition hover:from-amber-100 hover:to-orange-100 dark:from-amber-500/10 dark:to-orange-500/10 dark:hover:from-amber-500/20 dark:hover:to-orange-500/20'>
          <span className='flex shrink-0 items-center gap-1.5 text-amber-600 dark:text-amber-400'>
            <Radio className='h-4 w-4 animate-pulse' />
          </span>
          <div className='relative min-w-0 flex-1'>
            <BroadcastLine key={activeIndex} item={active} onOpen={() => setOpen(true)} />
          </div>
        </div>
      </div>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Global Broadcast')}
        description={t('Latest broadcasts from the platform')}
        contentClassName='max-w-lg'
        contentHeight='auto'
        bodyClassName='space-y-3'
        footer={
          <button
            type='button'
            onClick={() => setOpen(false)}
            className='inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90'
          >
            <X className='h-4 w-4' />
            {t('Close')}
          </button>
        }
      >
        {broadcasts.map((b, i) => (
          <div
            key={b.id ?? i}
            className='flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3'
          >
            <span
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${accent}`}
            />
            <div className='min-w-0 flex-1 space-y-1'>
              <div className='flex items-center gap-2'>
                <StatusBadge
                  label={b.type ?? 'default'}
                  variant={badgeVariantMap[b.type ?? 'default']}
                  copyable={false}
                />
              </div>
              <p className='text-sm leading-relaxed text-foreground'>
                {b.content}
              </p>
              {b.extra ? (
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  {b.extra}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </Dialog>
    </>
  )
}
