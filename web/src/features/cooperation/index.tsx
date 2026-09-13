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
import { Handshake, Plus } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { useIsAdminSidebarModuleVisible } from '@/hooks/use-sidebar-config'
import { useStatus } from '@/hooks/use-status'

import { getMyCooperationApplications, cooperationQueryKeys } from './api'
import { ApplicationCard } from './components/application-card'
import { ApplicationFormDialog } from './components/application-form-dialog'
import { getCooperationMethodOptions } from './constants'
import { COOPERATION_STATUS } from './types'

/**
 * 用户端「合作推广」页面：介绍说明 + 提交申请入口 + 我的申请卡片列表。
 * 存在待审核申请时禁用提交入口（后端同样强制「同时仅一条待审核」）。
 */
export function CooperationPromotion() {
  const { t } = useTranslation()
  const [applyOpen, setApplyOpen] = useState(false)

  // 「提交申请」入口用管理员级开关判定，与服务端模块 gate 同源；
  // 不叠加用户个人收窄层，避免个人隐藏侧边栏的用户被误禁提交
  const moduleEnabled = useIsAdminSidebarModuleVisible('/cooperation')

  // 管理员在系统设置中开放的合作方式（含自定义），未配置时解析函数回落内置全集
  const { status } = useStatus()
  const enabledMethods = useMemo(
    () =>
      getCooperationMethodOptions(
        status?.CooperationMethodsAdmin as string | null | undefined
      ),
    [status?.CooperationMethodsAdmin]
  )

  const listQuery = useQuery({
    queryKey: cooperationQueryKeys.myApplications,
    queryFn: getMyCooperationApplications,
  })

  const applications = listQuery.data ?? []
  const hasPending = applications.some(
    (application) => application.status === COOPERATION_STATUS.PENDING
  )

  let listContent: ReactNode
  if (listQuery.isLoading) {
    listContent = (
      <div className='flex flex-col gap-4'>
        {[0, 1].map((index) => (
          <div
            key={index}
            className='bg-muted/50 h-40 animate-pulse rounded-xl'
          />
        ))}
      </div>
    )
  } else if (applications.length === 0) {
    listContent = (
      <EmptyState
        icon={Handshake}
        title={t('No applications yet')}
        description={t(
          'Submit your first cooperation application and we will get back to you.'
        )}
        action={
          moduleEnabled && !hasPending ? (
            <Button onClick={() => setApplyOpen(true)}>
              {t('Submit Cooperation Application')}
            </Button>
          ) : undefined
        }
      />
    )
  } else {
    listContent = (
      <div className='grid gap-4 lg:grid-cols-3'>
        {applications.map((application) => (
          <ApplicationCard key={application.id} application={application} />
        ))}
      </div>
    )
  }

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Cooperation & Promotion')}
        </SectionPageLayout.Title>
        {moduleEnabled ? (
          <SectionPageLayout.Actions>
            <Button
              size='sm'
              onClick={() => setApplyOpen(true)}
              disabled={hasPending}
              title={
                hasPending
                  ? t('You already have a pending application under review')
                  : undefined
              }
            >
              <Plus aria-hidden='true' />
              {t('Submit Cooperation Application')}
            </Button>
          </SectionPageLayout.Actions>
        ) : null}
        <SectionPageLayout.Content>
          <div className='flex flex-col gap-4'>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Partner with us through token sponsorship, user invitations, content creation and more. Submit an application and our team will review it.'
              )}
            </p>
            {listContent}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      {/* 弹窗不能作为 SectionPageLayout 的直接子节点：
          该布局只渲染 Title/Actions/Content/Breadcrumb 插槽，
          其它子节点会被静默丢弃（规范见 web/AGENTS.md 3.3 组件） */}
      <ApplicationFormDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        enabledMethods={enabledMethods}
      />
    </>
  )
}
