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
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { formatNumber, formatQuota, formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getUser } from '../../api'
import {
  BINDING_FIELDS,
  REGISTRATION_SOURCE,
  USER_BAN_REASON_LABEL_KEYS,
  USER_REGISTRATION_SOURCES,
  USER_ROLES,
  USER_STATUS,
  USER_STATUSES,
  isUserDeleted,
} from '../../constants'
import type { User } from '../../types'

type UserDetailDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Row data used as the immediate source, then refreshed from the detail API. */
  user: User | null
}

/** Bindings are listed on their own; email stays in the basic information block. */
const BINDING_DETAIL_FIELDS = BINDING_FIELDS.filter(
  (field) => field.key !== 'email'
)

function DetailRow(props: {
  label: string
  /** Spans two grid columns for free-text values such as remarks. */
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className={cn('min-w-0 space-y-1', props.wide && 'sm:col-span-2')}>
      <div className='text-muted-foreground text-xs'>{props.label}</div>
      <div className='min-w-0 text-sm font-medium break-words'>
        {props.children}
      </div>
    </div>
  )
}

function DetailSection(props: { title: string; children: ReactNode }) {
  return (
    <section className='space-y-3'>
      <h3 className='text-sm font-medium'>{props.title}</h3>
      <div className='grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4'>
        {props.children}
      </div>
    </section>
  )
}

export function UserDetailDialog(props: UserDetailDialogProps) {
  const { t } = useTranslation()
  const userId = props.user?.id ?? null

  const { data, isFetching } = useQuery({
    queryKey: ['user-detail', userId],
    queryFn: () => (userId === null ? null : getUser(userId)),
    enabled: props.open && userId !== null,
  })

  const user = data?.success ? (data.data ?? props.user) : props.user

  const title = (
    <span className='flex items-center gap-2'>
      {t('User Details')}
      {isFetching ? (
        <Loader2
          className='text-muted-foreground size-4 animate-spin'
          aria-hidden='true'
        />
      ) : null}
    </span>
  )

  const footer = (
    <Button variant='outline' onClick={() => props.onOpenChange(false)}>
      {t('Close')}
    </Button>
  )

  if (!user) {
    return (
      <Dialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        title={title}
        contentClassName='sm:max-w-4xl'
        footer={footer}
      >
        <p className='text-muted-foreground py-8 text-center text-sm'>
          {t('No user information available')}
        </p>
      </Dialog>
    )
  }

  const statusKey = isUserDeleted(user) ? USER_STATUS.DELETED : user.status
  const statusConfig = USER_STATUSES[statusKey as keyof typeof USER_STATUSES]
  const roleConfig = USER_ROLES[user.role as keyof typeof USER_ROLES]
  const sourceConfig =
    USER_REGISTRATION_SOURCES[
      (user.registration_source ??
        REGISTRATION_SOURCE.UNKNOWN) as keyof typeof USER_REGISTRATION_SOURCES
    ] ?? USER_REGISTRATION_SOURCES[REGISTRATION_SOURCE.UNKNOWN]
  const totalQuota = user.quota + user.used_quota

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={title}
      description={`#${user.id} · ${user.username}`}
      contentClassName='sm:max-w-4xl'
      bodyClassName='space-y-4'
      footer={footer}
    >
      <DetailSection title={t('Basic Information')}>
        <DetailRow label={t('Username')}>{user.username}</DetailRow>
        <DetailRow label={t('Display Name')}>
          {user.display_name || '-'}
        </DetailRow>
        <DetailRow label={t('Email')}>{user.email || t('Not bound')}</DetailRow>
        <DetailRow label={t('Status')}>
          {statusConfig ? (
            <StatusBadge
              label={t(statusConfig.labelKey)}
              variant={statusConfig.variant}
              copyable={false}
            />
          ) : (
            String(user.status)
          )}
        </DetailRow>
        <DetailRow label={t('Role')}>
          {roleConfig ? t(roleConfig.labelKey) : String(user.role)}
        </DetailRow>
        <DetailRow label={t('Group')}>
          <GroupBadge group={user.group} />
        </DetailRow>
        <DetailRow label={t('Registration Source')}>
          {t(sourceConfig.labelKey)}
        </DetailRow>
        <DetailRow label={t('Remark')} wide>
          {user.remark || '-'}
        </DetailRow>
        {user.ban_reason ? (
          <DetailRow label={t('Disabled Reason')} wide>
            {USER_BAN_REASON_LABEL_KEYS[user.ban_reason]
              ? t(USER_BAN_REASON_LABEL_KEYS[user.ban_reason])
              : user.ban_reason}
          </DetailRow>
        ) : null}
      </DetailSection>

      <Separator />

      <DetailSection title={t('Quota Information')}>
        <DetailRow label={t('Balance')}>{formatQuota(user.quota)}</DetailRow>
        <DetailRow label={t('Used Quota')}>
          {formatQuota(user.used_quota)}
        </DetailRow>
        <DetailRow label={t('Total Quota')}>
          {formatQuota(totalQuota)}
        </DetailRow>
        <DetailRow label={t('Request Count')}>
          {formatNumber(user.request_count)}
        </DetailRow>
      </DetailSection>

      <Separator />

      <DetailSection title={t('Invitation Information')}>
        <DetailRow label={t('Invitation Code')}>
          {user.aff_code || '-'}
        </DetailRow>
        <DetailRow label={t('Invited Users')}>
          {formatNumber(user.aff_count ?? 0)}
        </DetailRow>
        <DetailRow label={t('Invitation Quota')}>
          {formatQuota(user.aff_quota ?? 0)}
        </DetailRow>
        <DetailRow label={t('Total invitation revenue')}>
          {formatQuota(user.aff_history_quota ?? 0)}
        </DetailRow>
        <DetailRow label={t('Inviter')}>
          {user.inviter_id ? `#${user.inviter_id}` : t('No Inviter')}
        </DetailRow>
      </DetailSection>

      <Separator />

      <DetailSection title={t('Third-party Bindings')}>
        {BINDING_DETAIL_FIELDS.map((field) => (
          <DetailRow key={field.key} label={t(field.label)}>
            {(user[field.key as keyof User] as string) || t('Not bound')}
          </DetailRow>
        ))}
      </DetailSection>

      <Separator />

      <DetailSection title={t('Login Activity')}>
        <DetailRow label={t('Created At')}>
          {user.created_at ? formatTimestamp(user.created_at) : '-'}
        </DetailRow>
        <DetailRow label={t('Updated At')}>
          {user.updated_at ? formatTimestamp(user.updated_at) : '-'}
        </DetailRow>
        <DetailRow label={t('Last Login')}>
          {user.last_login_at ? formatTimestamp(user.last_login_at) : '-'}
        </DetailRow>
        <DetailRow label={t('Login IP')}>{user.last_login_ip || '-'}</DetailRow>
      </DetailSection>
    </Dialog>
  )
}
