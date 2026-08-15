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

For commercial licensing, please contact support@quantumnous.com
*/
import { useState } from 'react'
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

// Read the latest status snapshot directly from localStorage. This hook keeps
// the in-memory react-query cache fresh, but we render from localStorage so the
// broadcast is always based on the most recently persisted payload.
function getBroadcastsFromStorage(): BroadcastItem[] {
  try {
    if (typeof window === 'undefined') return []
    const raw = window.localStorage.getItem('status')
    if (!raw) return []
    const status = JSON.parse(raw) as SystemStatus
    return (status?.broadcasts ?? []) as BroadcastItem[]
  } catch {
    return []
  }
}

/**
 * Global broadcast marquee placed next to the logo in the header.
 * Content scrolls right-to-left; clicking opens a popup with details.
 * Always rendered (no breakpoint / enabled / data gating).
 */
export function GlobalBroadcast() {
  const { t } = useTranslation()
  // Keep the cache warm / refresh localStorage in the background.
  useStatus()
  const broadcasts = getBroadcastsFromStorage()
  const [open, setOpen] = useState(false)

  const accent = dotColorMap[broadcasts[0]?.type ?? 'default']

  return (
    <>
      <div className='min-w-[320px] flex-1 rounded-full bg-gradient-to-r from-red-400 via-orange-400 to-yellow-400 p-[2px] shadow-sm transition hover:shadow-[0_0_10px_rgba(239,68,68,0.4)] dark:from-red-500 dark:via-orange-500 dark:to-yellow-500'>
        <button
          type='button'
          onClick={() => setOpen(true)}
          aria-label={t('Global Broadcast')}
          className='flex h-7 w-full items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-amber-50 to-orange-50 px-3 transition hover:from-amber-100 hover:to-orange-100 dark:from-amber-500/10 dark:to-orange-500/10 dark:hover:from-amber-500/20 dark:hover:to-orange-500/20'
        >
        <span className='flex shrink-0 items-center gap-1.5 text-amber-600 dark:text-amber-400'>
          <Radio className='h-4 w-4 animate-pulse' />
        </span>
        <div className='relative flex-1 overflow-hidden'>
          <div className='marquee-track flex w-max items-center gap-10 whitespace-nowrap'>
            {broadcasts.length === 0 ? (
              <span className='text-xs font-medium text-amber-900 dark:text-amber-100'>
                {t('Global Broadcast')}
              </span>
            ) : (
              // Duplicate enough times so the track is always wider than the
              // container; the marquee animation translates by -25% (one copy)
              // for a seamless loop.
              [...broadcasts, ...broadcasts, ...broadcasts, ...broadcasts].map(
                (b, i) => (
                  <span
                    key={`${b.id ?? i}-${i}`}
                    className='flex items-center gap-2 text-xs font-medium text-amber-900 dark:text-amber-100'
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${dotColorMap[b.type ?? 'default']}`}
                    />
                    {b.content}
                  </span>
                )
              )
            )}
          </div>
        </div>
        </button>
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
