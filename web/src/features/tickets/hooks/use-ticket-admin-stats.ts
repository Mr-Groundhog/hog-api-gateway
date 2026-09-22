/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { useQuery } from '@tanstack/react-query'

import { useIsSidebarModuleVisible } from '@/hooks/use-sidebar-config'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { getAdminTicketStats, ticketQueryKeys } from '../api'

/**
 * 管理端待处理工单数（stats.pending），驱动侧边栏「工单管理」徽标与统计条。
 * 不涉及任何已读状态：只有真正「回复」才会让工单离开待办队列，
 * 管理员打开工单查看不会改变角标——这正是共享收件箱想要的行为。
 * options.enabled 供徽标叠加「模块被隐藏」条件；统计条不传，保持页面自身可用。
 */
export function useTicketAdminStats(options?: { enabled?: boolean }) {
  const user = useAuthStore((s) => s.auth.user)
  const isAdmin = (user?.role ?? 0) >= ROLE.ADMIN
  const query = useQuery({
    queryKey: ticketQueryKeys.adminStats,
    queryFn: getAdminTicketStats,
    enabled: Boolean(user) && isAdmin && (options?.enabled ?? true),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })
  return query
}

/**
 * 侧边栏「工单管理」徽标用的待处理计数。
 * 非管理员、或「工单管理」模块被隐藏时不发请求，恒为 0；
 * 页面内的统计条不经过这里，模块关闭时页面仍照常取数。
 */
export function useTicketAdminPendingCount(): number {
  const isVisible = useIsSidebarModuleVisible('/ticket-management')
  const query = useTicketAdminStats({ enabled: isVisible })
  return query.data?.pending ?? 0
}
