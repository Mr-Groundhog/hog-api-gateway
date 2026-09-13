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

You should have received a copy of the GNU Affero General License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { COOPERATION_SITE_TYPES } from '@/features/cooperation/constants'

import type { PartnerSite } from '../types'

/** 站点类型标签：右上角角标；未知类型（含未设置）不渲染。 */
function SiteTypeBadge(props: { siteType: string }) {
  const { t } = useTranslation()
  const config =
    COOPERATION_SITE_TYPES[
      props.siteType as keyof typeof COOPERATION_SITE_TYPES
    ]
  if (!config) return null
  return (
    <span className='bg-background/90 text-foreground/80 absolute top-2 right-2 z-10 rounded-full px-2.5 py-0.5 text-xs font-medium shadow-sm backdrop-blur-sm'>
      {t(config.labelKey)}
    </span>
  )
}

/**
 * 普通合作站点卡片：有封面图时上方撑满显示封面（object-cover 裁切），
 * 下方为 Logo（缺失时以名称首字回退）+ 名称 + 简介 + 外链；无封面时回退为
 * 紧凑的纯文字卡片。设置了站点类型时封面右上角展示类型角标。
 */
export function SiteCard(props: { site: PartnerSite }) {
  const site = props.site
  return (
    <a
      href={site.url}
      target='_blank'
      rel='noopener noreferrer'
      className='bg-card group hover:border-primary/40 relative flex flex-col overflow-hidden rounded-lg border transition hover:shadow-sm focus-visible:outline-none'
    >
      <SiteTypeBadge siteType={site.site_type} />
      {site.banner && (
        <div className='from-primary/15 via-primary/5 bg-gradient-to-br to-transparent h-36 shrink-0 overflow-hidden border-b'>
          <img
            src={site.banner}
            alt={site.name}
            loading='lazy'
            className='h-full w-full object-cover'
          />
        </div>
      )}
      <div className='flex flex-1 items-start gap-3 p-5'>
        {site.logo ? (
          <img
            src={site.logo}
            alt=''
            loading='lazy'
            className='size-12 shrink-0 rounded-lg border object-cover'
          />
        ) : (
          <span className='bg-primary/10 text-primary flex size-12 shrink-0 items-center justify-center rounded-lg text-lg font-bold'>
            {site.name.charAt(0).toUpperCase()}
          </span>
        )}
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-1.5'>
            <h3 className='truncate text-sm font-semibold'>{site.name}</h3>
            <ExternalLink
              className='text-muted-foreground size-3.5 shrink-0 opacity-0 transition group-hover:opacity-100'
              aria-hidden='true'
            />
          </div>
          {site.description && (
            <p className='text-muted-foreground mt-1.5 line-clamp-2 text-sm'>
              {site.description}
            </p>
          )}
        </div>
      </div>
    </a>
  )
}
