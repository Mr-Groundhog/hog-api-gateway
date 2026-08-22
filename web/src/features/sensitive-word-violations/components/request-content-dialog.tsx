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
import { Crosshair } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

import type { SensitiveWordViolation } from '../api'
import { findMatchSegments, parseMatchedWords } from '../lib/matches'

export function RequestContentDialog(props: {
  violation: SensitiveWordViolation | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [activeMatch, setActiveMatch] = useState(-1)
  const contentRef = useRef<HTMLPreElement>(null)
  const violationId = props.violation?.id

  // Opening a different record must start the search over from its first hit.
  useEffect(() => {
    setActiveMatch(-1)
  }, [violationId])

  const words = useMemo(
    () => parseMatchedWords(props.violation?.matched_words),
    [props.violation?.matched_words]
  )
  const segments = useMemo(
    () => findMatchSegments(props.violation?.request_content ?? '', words),
    [props.violation?.request_content, words]
  )
  const matchCount = segments.filter(
    (segment) => segment.matchIndex !== null
  ).length

  const jumpToNextMatch = () => {
    if (matchCount === 0) return
    const next = (activeMatch + 1) % matchCount
    setActiveMatch(next)
    contentRef.current
      ?.querySelector<HTMLElement>(`[data-match-index="${next}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  let matchStatus = t('No match found in the request content.')
  if (matchCount > 0 && activeMatch < 0) {
    matchStatus = t('{{count}} matches found', { count: matchCount })
  } else if (matchCount > 0) {
    matchStatus = t('Match {{current}} of {{total}}', {
      current: activeMatch + 1,
      total: matchCount,
    })
  }

  const body = segments.map((segment, index) => {
    if (segment.matchIndex === null) {
      return <Fragment key={index}>{segment.text}</Fragment>
    }
    const isActive = segment.matchIndex === activeMatch
    return (
      <mark
        key={index}
        data-match-index={segment.matchIndex}
        aria-current={isActive ? 'true' : undefined}
        className={cn(
          'rounded px-0.5',
          isActive
            ? 'bg-destructive text-destructive-foreground ring-destructive/40 ring-2'
            : 'bg-warning/30 text-foreground'
        )}
      >
        {segment.text}
      </mark>
    )
  })

  return (
    <Dialog
      open={props.violation !== null}
      onOpenChange={(open) => !open && props.onClose()}
    >
      <DialogContent className='sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{t('Request Content')}</DialogTitle>
          <DialogDescription>
            {props.violation &&
              `${new Date(props.violation.created_at * 1000).toLocaleString()} · ${props.violation.request_path}`}
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='flex min-w-0 flex-wrap items-center gap-1.5'>
            <span className='text-muted-foreground text-xs'>
              {t('Matched Words')}
            </span>
            {words.length === 0 && (
              <span className='text-muted-foreground text-xs'>-</span>
            )}
            {words.map((word) => (
              <Badge key={word} variant='destructive'>
                {word}
              </Badge>
            ))}
          </div>
          <div className='flex shrink-0 items-center gap-2'>
            <span
              aria-live='polite'
              className='text-muted-foreground text-xs tabular-nums'
            >
              {matchStatus}
            </span>
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={matchCount === 0}
              onClick={jumpToNextMatch}
            >
              <Crosshair />
              {t('Jump to match')}
            </Button>
          </div>
        </div>
        <pre
          ref={contentRef}
          className='max-h-[60vh] overflow-auto rounded border p-3 text-xs break-words whitespace-pre-wrap'
        >
          {body.length > 0 ? body : '-'}
        </pre>
      </DialogContent>
    </Dialog>
  )
}
