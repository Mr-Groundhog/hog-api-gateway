/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistributeit and/or modify
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

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, CircleX, Eye, Globe, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTableRowActionMenu } from '@/components/data-table/core/row-action-menu'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { formatTimestampToDate } from '@/lib/format'

import {
  cooperationQueryKeys,
  deleteCooperationApplication,
  reviewCooperationApplication,
} from '../api'
import { COOPERATION_VALIDATION } from '../constants'
import { COOPERATION_STATUS, type CooperationApplication } from '../types'
import {
  CooperationMethodTags,
  CooperationSiteTypeLabel,
  CooperationStatusBadge,
} from './label-bits'
import { SiteFormDialog } from './site-form-dialog'

/** 申请详情弹窗：完整展示所有字段，供管理员审核前查看。 */
function ApplicationDetailDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  application: CooperationApplication
}) {
  const { t } = useTranslation()
  const application = props.application
  const fields: { label: string; value: string }[] = [
    { label: t('Site Name'), value: application.site_name },
    { label: t('Site URL'), value: application.site_url },
    { label: t('Audience Size'), value: application.audience },
    { label: t('Contact Information'), value: application.contact },
    {
      label: t('Applied at'),
      value: formatTimestampToDate(application.created_time),
    },
  ]
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{application.site_name}</DialogTitle>
          <DialogDescription>
            {t('Applicant')}
            {': '}
            {application.username} (#{application.user_id})
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-4'>
          <div className='flex flex-wrap items-center gap-2'>
            <CooperationSiteTypeLabel siteType={application.site_type} />
            <CooperationStatusBadge status={application.status} />
          </div>
          <div className='flex flex-col gap-3'>
            {fields.map((field) => (
              <div
                key={field.label}
                className='grid grid-cols-[auto_1fr] gap-3 text-sm'
              >
                <span className='text-muted-foreground whitespace-nowrap'>
                  {field.label}
                </span>
                <span className='min-w-0 break-all'>{field.value}</span>
              </div>
            ))}
          </div>
          <div className='flex flex-col gap-1.5'>
            <span className='text-muted-foreground text-sm'>
              {t('Cooperation Methods')}
            </span>
            <CooperationMethodTags methods={application.methods} />
          </div>
          <div className='flex flex-col gap-1.5'>
            <span className='text-muted-foreground text-sm'>
              {t('Site Description')}
            </span>
            <p className='text-sm whitespace-pre-wrap'>
              {application.description}
            </p>
          </div>
          {application.notes && (
            <div className='flex flex-col gap-1.5'>
              <span className='text-muted-foreground text-sm'>
                {t('Additional Notes')}
              </span>
              <p className='text-sm whitespace-pre-wrap'>{application.notes}</p>
            </div>
          )}
          {application.review_note && (
            <div className='bg-muted/50 rounded-md border p-3 text-sm'>
              <span className='text-muted-foreground'>
                {t('Review Note')}
                {': '}
              </span>
              <span className='whitespace-pre-wrap'>
                {application.review_note}
              </span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 管理端行操作：查看详情、通过 / 驳回待审核申请、删除。驳回必须填写原因。 */
export function CooperationRowActions(props: {
  application: CooperationApplication
}) {
  const { t } = useTranslation()
  const application = props.application
  const client = useQueryClient()
  const [detailOpen, setDetailOpen] = useState(false)
  const [approveOpen, setApproveOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [showcaseOpen, setShowcaseOpen] = useState(false)
  const [approveNote, setApproveNote] = useState('')
  const [rejectNote, setRejectNote] = useState('')

  const invalidate = () => {
    void client.invalidateQueries({
      queryKey: cooperationQueryKeys.adminList,
    })
    void client.invalidateQueries({
      queryKey: cooperationQueryKeys.adminStats,
    })
  }

  const approveMutation = useMutation({
    mutationFn: () =>
      reviewCooperationApplication(
        application.id,
        'approve',
        approveNote.trim()
      ),
    onSuccess: () => {
      toast.success(t('Application approved'))
      setApproveOpen(false)
      setApproveNote('')
      invalidate()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t('Operation failed')
      )
    },
  })

  const rejectMutation = useMutation({
    mutationFn: () =>
      reviewCooperationApplication(application.id, 'reject', rejectNote.trim()),
    onSuccess: () => {
      toast.success(t('Application rejected'))
      setRejectOpen(false)
      setRejectNote('')
      invalidate()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t('Operation failed')
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteCooperationApplication(application.id),
    onSuccess: () => {
      toast.success(t('Application deleted'))
      setDeleteOpen(false)
      invalidate()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t('Operation failed')
      )
    },
  })

  const isPending = application.status === COOPERATION_STATUS.PENDING

  return (
    <>
      <Button
        variant='ghost'
        size='icon-sm'
        aria-label={t('View details')}
        onClick={() => setDetailOpen(true)}
      >
        <Eye aria-hidden='true' />
      </Button>
      <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
        <DropdownMenuItem onClick={() => setDetailOpen(true)}>
          {t('View details')}
          <DropdownMenuShortcut>
            <Eye size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        {isPending && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setApproveOpen(true)}>
              {t('Approve')}
              <DropdownMenuShortcut>
                <BadgeCheck size={16} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              className='text-destructive focus:text-destructive'
              onClick={() => setRejectOpen(true)}
            >
              {t('Reject')}
              <DropdownMenuShortcut>
                <CircleX size={16} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}
        {application.status === COOPERATION_STATUS.APPROVED && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setShowcaseOpen(true)}>
              {t('Add to partner sites')}
              <DropdownMenuShortcut>
                <Globe size={16} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className='text-destructive focus:text-destructive'
          onClick={() => setDeleteOpen(true)}
        >
          {t('Delete')}
          <DropdownMenuShortcut>
            <Trash2 size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      </DataTableRowActionMenu>

      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title={t('Approve application')}
        desc={t(
          'Approve the cooperation application from {{site}}. The site will be automatically added to the partner sites page. No quota will be granted.',
          { site: application.site_name }
        )}
        confirmText={t('Approve')}
        isLoading={approveMutation.isPending}
        handleConfirm={() => approveMutation.mutate()}
      >
        <Input
          value={approveNote}
          onChange={(e) => setApproveNote(e.target.value)}
          placeholder={t('Review note (optional)')}
          maxLength={COOPERATION_VALIDATION.REVIEW_NOTE_MAX_LENGTH}
          className='mt-3'
          aria-label={t('Review note (optional)')}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title={t('Reject application')}
        desc={t(
          'Reject the cooperation application from {{site}}. A reason is required.',
          { site: application.site_name }
        )}
        destructive
        confirmText={t('Reject')}
        disabled={rejectNote.trim() === ''}
        isLoading={rejectMutation.isPending}
        handleConfirm={() => rejectMutation.mutate()}
      >
        <Input
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          placeholder={t('Enter reject reason')}
          maxLength={COOPERATION_VALIDATION.REVIEW_NOTE_MAX_LENGTH}
          className='mt-3'
          aria-label={t('Enter reject reason')}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('Delete application')}
        desc={t(
          'This will permanently delete the application from {{site}}. This action cannot be undone.',
          { site: application.site_name }
        )}
        destructive
        confirmText={t('Delete')}
        isLoading={deleteMutation.isPending}
        handleConfirm={() => deleteMutation.mutate()}
      />

      {/* 已通过申请一键上架：把申请里的站点信息预填进「合作站点」新建表单 */}
      <SiteFormDialog
        open={showcaseOpen}
        onOpenChange={setShowcaseOpen}
        site={null}
        initialValues={{
          name: application.site_name,
          url: application.site_url,
          logo: '',
          banner: application.site_banner,
          siteType: application.site_type ?? '',
          description: application.description,
          sort: '0',
          featured: false,
          enabled: true,
        }}
      />

      <ApplicationDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        application={application}
      />
    </>
  )
}
