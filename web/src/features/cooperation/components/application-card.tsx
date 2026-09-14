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

import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { formatTimestampToDate } from '@/lib/format'

import { COOPERATION_STATUS, type CooperationApplication } from '../types'
import {
  CooperationMethodTags,
  CooperationSiteTypeLabel,
  CooperationStatusBadge,
} from './label-bits'

/** 用户端「我的申请」卡片：站点信息 + 合作方式 + 审核状态与备注。 */
export function ApplicationCard(props: {
  application: CooperationApplication
}) {
  const { t } = useTranslation()
  const application = props.application
  const reviewed =
    application.status === COOPERATION_STATUS.APPROVED ||
    application.status === COOPERATION_STATUS.REJECTED

  return (
    <Card className='overflow-hidden'>
      {application.site_banner && (
        <a
          href={application.site_url}
          target='_blank'
          rel='noopener noreferrer'
          className='block focus-visible:outline-none'
        >
          <img
            src={application.site_banner}
            alt=''
            loading='lazy'
            className='h-24 w-full object-cover sm:h-28'
          />
        </a>
      )}
      <CardHeader>
        <div className='flex flex-wrap items-start justify-between gap-2'>
          <div className='min-w-0'>
            <CardTitle className='truncate text-base'>
              {application.site_name}
            </CardTitle>
            <CardDescription className='mt-1 flex flex-wrap items-center gap-x-2 gap-y-1'>
              <a
                href={application.site_url}
                target='_blank'
                rel='noopener noreferrer'
                className='text-primary inline-flex max-w-full items-center gap-1 truncate hover:underline'
              >
                <span className='truncate'>{application.site_url}</span>
                <ExternalLink className='size-3 shrink-0' aria-hidden='true' />
              </a>
              <span aria-hidden='true'>·</span>
              <CooperationSiteTypeLabel siteType={application.site_type} />
              <span aria-hidden='true'>·</span>
              <span className='whitespace-nowrap'>
                {formatTimestampToDate(application.created_time)}
              </span>
            </CardDescription>
          </div>
          <CooperationStatusBadge status={application.status} />
        </div>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        <p className='line-clamp-2 text-sm whitespace-pre-wrap'>
          {application.description}
        </p>
        <CooperationMethodTags methods={application.methods} />
        {reviewed && application.review_note && (
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
      </CardContent>
    </Card>
  )
}
