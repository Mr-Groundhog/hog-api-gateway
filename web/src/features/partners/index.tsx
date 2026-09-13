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
import { Handshake } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import { Skeleton } from '@/components/ui/skeleton'

import { getPartnerSites, partnersQueryKeys } from './api'
import { SiteCard } from './components/site-card'

/**
 * 「合作站点」公共展示页：全部站点以卡片网格展示，重点站点（featured）
 * 优先排在前面，其余按管理端配置的序号（越小越靠前）排序。
 * 页面入口由顶部导航 partners 模块开关控制（默认关闭）。
 */
export function PartnerSites() {
  const { t } = useTranslation()
  const sitesQuery = useQuery({
    queryKey: partnersQueryKeys.sites,
    queryFn: getPartnerSites,
  })

  const sites = sitesQuery.data ?? []
  // 重点站点优先展示：接口按 sort 升序返回，此处稳定地把 featured 排到前面
  const ordered = [...sites].sort(
    (a, b) => Number(b.featured) - Number(a.featured)
  )

  let bodyContent: ReactNode
  if (sitesQuery.isLoading) {
    bodyContent = (
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className='h-56 w-full rounded-lg' />
        ))}
      </div>
    )
  } else if (sitesQuery.isError) {
    bodyContent = (
      <div className='bg-card rounded-xl border border-dashed px-6 py-12 text-center'>
        <h2 className='text-foreground text-base font-semibold'>
          {t('Unable to load partner sites')}
        </h2>
        <p className='text-muted-foreground mx-auto mt-2 max-w-md text-sm'>
          {sitesQuery.error instanceof Error
            ? sitesQuery.error.message
            : t('Please try again later')}
        </p>
      </div>
    )
  } else if (sites.length === 0) {
    bodyContent = (
      <EmptyState
        icon={Handshake}
        title={t('No partner sites yet')}
        description={t(
          'Partner sites will be showcased here once cooperation is established.'
        )}
      />
    )
  } else {
    bodyContent = (
      <section className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        {ordered.map((site) => (
          <SiteCard key={site.id} site={site} />
        ))}
      </section>
    )
  }

  return (
    <PublicLayout showMainContainer={false}>
      <div className='relative'>
        <div
          aria-hidden
          className='pointer-events-none absolute inset-x-0 top-0 h-[600px] opacity-20 dark:opacity-[0.10]'
          style={{
            background: [
              'radial-gradient(ellipse 60% 50% at 20% 20%, oklch(0.72 0.18 250 / 80%) 0%, transparent 70%)',
              'radial-gradient(ellipse 50% 40% at 80% 15%, oklch(0.65 0.15 200 / 60%) 0%, transparent 70%)',
              'radial-gradient(ellipse 40% 35% at 50% 70%, oklch(0.70 0.12 280 / 40%) 0%, transparent 70%)',
            ].join(', '),
            maskImage:
              'linear-gradient(to bottom, black 40%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, black 40%, transparent 100%)',
          }}
        />
        <PageTransition className='relative mx-auto w-full max-w-[1280px] space-y-8 px-3 pt-16 pb-10 sm:px-6 sm:pt-20 sm:pb-12 xl:px-8'>
          <header className='space-y-3'>
            <h1 className='text-[clamp(1.75rem,4vw,2.5rem)] leading-[1.15] font-bold tracking-tight'>
              {t('Partner Sites')}
            </h1>
            <p className='text-muted-foreground/80 max-w-2xl text-sm'>
              {t(
                'Trusted communities, tools and creators cooperating with us. Reach out from the Cooperation & Promotion page to join them.'
              )}
            </p>
          </header>

          {bodyContent}
        </PageTransition>
      </div>
    </PublicLayout>
  )
}
