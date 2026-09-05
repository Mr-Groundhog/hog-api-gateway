/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import {
  closeSelfTicket,
  getSelfTicketDetail,
  replySelfTicket,
  ticketQueryKeys,
} from '../api'
import { SUCCESS_MESSAGES } from '../constants'
import { TICKET_STATUS } from '../types'
import { TicketComposer } from './ticket-composer'
import { TicketStatusBadge } from './ticket-status-badge'
import { TicketThread } from './ticket-thread'
import { TicketTypeLabel } from './ticket-type-label'

type TicketDetailSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  ticketId: number | null
}

/**
 * 用户端工单详情抽屉。打开详情时服务端顺带写 user_read_time，
 * 成功后失效 unread 与列表，让侧边栏红点与行内「管理员已回复」标记立即消失。
 */
export function TicketDetailSheet(props: TicketDetailSheetProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const detailQuery = useQuery({
    queryKey: ticketQueryKeys.detail(props.ticketId ?? 0),
    queryFn: () => getSelfTicketDetail(props.ticketId as number),
    enabled: props.open && props.ticketId !== null,
  })

  // 打开详情即视为已读（服务端已写 user_read_time），红点与列表标记即时消失
  useEffect(() => {
    if (detailQuery.isSuccess) {
      void queryClient.invalidateQueries({ queryKey: ticketQueryKeys.unread })
      void queryClient.invalidateQueries({ queryKey: ticketQueryKeys.list })
    }
  }, [detailQuery.isSuccess, queryClient])

  const refreshAfterChange = () => {
    void queryClient.invalidateQueries({ queryKey: ticketQueryKeys.unread })
    void queryClient.invalidateQueries({ queryKey: ticketQueryKeys.list })
    void queryClient.invalidateQueries({
      queryKey: ticketQueryKeys.detail(props.ticketId ?? 0),
    })
  }

  const replyMutation = useMutation({
    mutationFn: (content: string) =>
      replySelfTicket(props.ticketId as number, content),
    onSuccess: () => {
      refreshAfterChange()
    },
    onError: handleServerError,
  })

  const closeMutation = useMutation({
    mutationFn: () => closeSelfTicket(props.ticketId as number),
    onSuccess: () => {
      toast.success(t(SUCCESS_MESSAGES.TICKET_CLOSED))
      refreshAfterChange()
    },
    onError: handleServerError,
  })

  const detail = detailQuery.data
  const closed = detail?.status === TICKET_STATUS.CLOSED
  let disabledReason: string | undefined
  if (closed) {
    disabledReason = t('This ticket is closed and no longer accepts replies.')
  } else if (detail?.canReply === false) {
    disabledReason = t('This ticket has reached its message limit.')
  }

  let messageArea: ReactNode
  if (detailQuery.isLoading) {
    messageArea = (
      <p className='text-muted-foreground py-8 text-center text-sm'>
        {t('Loading...')}
      </p>
    )
  } else if (detail) {
    messageArea = <TicketThread messages={detail.messages} />
  } else {
    messageArea = (
      <p className='text-muted-foreground py-8 text-center text-sm'>
        {t('Failed to load tickets')}
      </p>
    )
  }

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className={sideDrawerContentClassName('sm:max-w-2xl')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle className='flex items-center gap-2'>
            <span className='truncate'>
              {detail ? `#${detail.id} ${detail.title}` : t('Ticket Details')}
            </span>
          </SheetTitle>
          <SheetDescription className='flex items-center gap-3'>
            {detail ? (
              <>
                <TicketTypeLabel type={detail.type} />
                <TicketStatusBadge status={detail.status} />
                <span>
                  {t('Created at {{time}}', {
                    time: formatTimestampToDate(detail.createdTime),
                  })}
                </span>
              </>
            ) : (
              t('Ticket Details')
            )}
          </SheetDescription>
        </SheetHeader>
        <div className='flex min-h-0 flex-1 flex-col'>
          <div className='flex min-h-0 flex-1 flex-col px-4 py-4 sm:px-6 sm:py-5'>
            {messageArea}
          </div>
          {detail ? (
            <div className='border-t px-4 py-4 sm:px-6 sm:py-5'>
              <TicketComposer
                label={t('Add a note…')}
                submitLabel={t('Submit Reply')}
                disabled={!detail.canReply || replyMutation.isPending}
                disabledReason={disabledReason}
                submitting={replyMutation.isPending}
                onSubmit={(content) => replyMutation.mutate(content)}
              />
            </div>
          ) : null}
        </div>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button variant='outline' />}>
            {t('Close')}
          </SheetClose>
          {detail && detail.canClose ? (
            <Button
              type='button'
              variant='destructive'
              disabled={closeMutation.isPending || closed}
              onClick={() => closeMutation.mutate()}
            >
              {t('Close Ticket')}
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
