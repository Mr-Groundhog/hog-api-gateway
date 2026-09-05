/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  getAdminTicketDetail,
  replyAdminTicket,
  ticketQueryKeys,
  updateAdminTicketStatus,
  deleteAdminTicket,
} from '../api'
import { SUCCESS_MESSAGES } from '../constants'
import { TICKET_STATUS } from '../types'
import { TicketComposer } from './ticket-composer'
import { TicketStatusBadge } from './ticket-status-badge'
import { TicketThread } from './ticket-thread'
import { TicketTypeLabel } from './ticket-type-label'

type AdminTicketDetailSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  ticketId: number | null
}

/**
 * 管理端详情抽屉：会话 + 回复框 + 关闭 / 重开 / 删除。打开动作无副作用，
 * 不改任何状态——管理端没有已读语义，待办队列由「待处理」状态派生。
 */
export function AdminTicketDetailSheet(props: AdminTicketDetailSheetProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [deleteOpen, setDeleteOpen] = useState(false)

  const detailQuery = useQuery({
    queryKey: ticketQueryKeys.detail(props.ticketId ?? 0),
    queryFn: () => getAdminTicketDetail(props.ticketId as number),
    enabled: props.open && props.ticketId !== null,
  })

  const refreshAfterChange = () => {
    void queryClient.invalidateQueries({ queryKey: ticketQueryKeys.adminList })
    void queryClient.invalidateQueries({ queryKey: ticketQueryKeys.adminStats })
    void queryClient.invalidateQueries({
      queryKey: ticketQueryKeys.detail(props.ticketId ?? 0),
    })
  }

  const replyMutation = useMutation({
    mutationFn: (content: string) =>
      replyAdminTicket(props.ticketId as number, content),
    onSuccess: () => {
      refreshAfterChange()
    },
    onError: handleServerError,
  })

  const statusMutation = useMutation({
    mutationFn: (status: number) =>
      updateAdminTicketStatus(props.ticketId as number, status),
    onSuccess: (_, status) => {
      toast.success(
        status === TICKET_STATUS.CLOSED
          ? t(SUCCESS_MESSAGES.TICKET_CLOSED)
          : t(SUCCESS_MESSAGES.TICKET_REOPENED)
      )
      refreshAfterChange()
    },
    onError: handleServerError,
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteAdminTicket(props.ticketId as number),
    onSuccess: () => {
      toast.success(t(SUCCESS_MESSAGES.TICKET_DELETED))
      setDeleteOpen(false)
      props.onOpenChange(false)
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
                <span>
                  {t('Submitted by {{name}}', {
                    name: detail.username || `#${detail.userId}`,
                  })}
                </span>
                <TicketTypeLabel type={detail.type} />
                <TicketStatusBadge status={detail.status} />
                <span>{formatTimestampToDate(detail.createdTime)}</span>
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
          {detail ? (
            <div className='flex gap-2'>
              <Button
                type='button'
                variant='destructive'
                disabled={deleteMutation.isPending}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 aria-hidden='true' />
                {t('Delete Ticket')}
              </Button>
              {closed ? (
                <Button
                  type='button'
                  disabled={statusMutation.isPending}
                  onClick={() => statusMutation.mutate(TICKET_STATUS.PENDING)}
                >
                  {t('Reopen Ticket')}
                </Button>
              ) : (
                <Button
                  type='button'
                  variant='outline'
                  disabled={statusMutation.isPending || !detail.canClose}
                  onClick={() => statusMutation.mutate(TICKET_STATUS.CLOSED)}
                >
                  {t('Close Ticket')}
                </Button>
              )}
            </div>
          ) : null}
        </SheetFooter>
      </SheetContent>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Delete Ticket')}</DialogTitle>
            <DialogDescription>
              {t(
                'This will permanently delete this ticket and all of its messages. This cannot be undone.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button
              variant='destructive'
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              <Trash2 aria-hidden='true' />
              {t('Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  )
}
