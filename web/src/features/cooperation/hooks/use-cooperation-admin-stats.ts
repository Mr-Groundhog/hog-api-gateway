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

import { useIsSidebarModuleVisible } from '@/hooks/use-sidebar-config'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { cooperationQueryKeys, getCooperationStats } from '../api'

/**
 * 侧边栏「合作推广」徽标用的待审核计数。刷新逻辑与工单管理徽标一致：
 * 进入系统后即时拉取、每 60 秒轮询、窗口重新聚焦时刷新；审核操作后由调用方
 * invalidate cooperationQueryKeys.adminStats 立即更新。
 * 额外约束：非管理员、或「合作管理」模块被隐藏时不发请求（恒为 0）。
 */
export function useCooperationAdminPendingCount(): number {
  const isVisible = useIsSidebarModuleVisible('/cooperation-management')
  const user = useAuthStore((s) => s.auth.user)
  const isAdmin = (user?.role ?? 0) >= ROLE.ADMIN
  const { data } = useQuery({
    queryKey: cooperationQueryKeys.adminStats,
    queryFn: getCooperationStats,
    enabled: Boolean(user) && isAdmin && isVisible,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })

  return data?.pending ?? 0
}
