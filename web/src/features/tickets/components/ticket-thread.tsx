/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { ArrowUp, Check, Copy } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { TICKET_AUTHOR_ROLE, type TicketMessage } from '../types'

type MessageBubbleProps = {
  message: TicketMessage
}

function MessageBubble(props: MessageBubbleProps) {
  const { t } = useTranslation()
  const { copyToClipboard, copiedText } = useCopyToClipboard()
  const { message } = props
  const isAdmin = message.authorRole === TICKET_AUTHOR_ROLE.ADMIN
  const copied = copiedText === message.content

  return (
    <div
      className={cn('flex w-full', isAdmin ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'flex max-w-[85%] flex-col gap-1 rounded-xl border px-3 py-2.5 sm:max-w-[75%]',
          isAdmin
            ? 'bg-primary/5 border-primary/20'
            : 'bg-muted/40 border-border/60'
        )}
      >
        <div className='flex items-center gap-2'>
          <Badge variant={isAdmin ? 'default' : 'outline'}>
            {isAdmin ? t('Admin') : t('User')}
          </Badge>
          <span className='text-muted-foreground truncate text-xs'>
            {message.username}
          </span>
          <span className='text-muted-foreground ml-auto shrink-0 text-xs'>
            {formatTimestampToDate(message.createdTime)}
          </span>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='text-muted-foreground size-5'
            aria-label={t('Copy')}
            onClick={() => void copyToClipboard(message.content)}
          >
            {copied ? (
              <Check className='size-3' aria-hidden='true' />
            ) : (
              <Copy className='size-3' aria-hidden='true' />
            )}
          </Button>
        </div>
        {/* 纯文本原样展示：React 默认转义，不引入 Markdown / 富文本渲染 */}
        <p className='text-sm leading-relaxed break-words whitespace-pre-wrap'>
          {message.content}
        </p>
      </div>
    </div>
  )
}

type TicketThreadProps = {
  messages: TicketMessage[]
}

/**
 * 会话气泡列表，用户端与管理端共用。气泡位置固定：用户消息靠左、管理员消息
 * 靠右，不随观看者视角翻转，保证用户截图与管理员看到的一致。
 */
export function TicketThread(props: TicketThreadProps) {
  const { t } = useTranslation()
  const threadRef = useRef<HTMLDivElement>(null)
  const [showBackToTop, setShowBackToTop] = useState(false)

  useLayoutEffect(() => {
    const thread = threadRef.current
    if (!thread) return

    const scrollToBottom = () => {
      thread.scrollTop = thread.scrollHeight
    }

    scrollToBottom()
    const frame = requestAnimationFrame(scrollToBottom)

    let resizeObserver: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(scrollToBottom)
      resizeObserver.observe(thread)
    }

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
    }
  }, [props.messages])

  const handleScroll = () => {
    const thread = threadRef.current
    if (!thread) return
    setShowBackToTop(
      thread.scrollHeight - thread.scrollTop - thread.clientHeight > 24
    )
  }

  return (
    <div className='relative flex min-h-0 flex-1'>
      <div
        ref={threadRef}
        data-slot='ticket-thread-scroll'
        className='flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain'
        aria-live='polite'
        onScroll={handleScroll}
      >
        {props.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>

      {showBackToTop ? (
        <Button
          type='button'
          variant='outline'
          size='icon'
          className='absolute right-4 bottom-4 z-10 rounded-full shadow-lg'
          aria-label={t('Back to top')}
          onClick={() => {
            const thread = threadRef.current
            if (thread) thread.scrollTop = 0
            setShowBackToTop(false)
          }}
        >
          <ArrowUp className='size-4' aria-hidden='true' />
        </Button>
      ) : null}
    </div>
  )
}
