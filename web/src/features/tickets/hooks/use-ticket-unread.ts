/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { useQuery } from '@tanstack/react-query'
import { useLocation } from '@tanstack/react-router'
import { useEffect } from 'react'

import { useIsSidebarModuleVisible } from '@/hooks/use-sidebar-config'
import { useAuthStore } from '@/stores/auth-store'

import { getSelfTicketUnread, ticketQueryKeys } from '../api'

/**
 * 当前用户的未读管理员回复数，驱动侧边栏「工单反馈」徽标。
 * 未登录或管理员隐藏工单模块时不发请求；仅在登录或进入工单反馈页时刷新，
 * 打开详情 / 提交追问后由调用方 invalidate `ticketQueryKeys.unread` 即时清零。
 * 与 useSidebarData、command-menu 共用同一 queryKey，React Query 自动去重。
 */
export function useTicketUnread(): number {
  const location = useLocation()
  const isVisible = useIsSidebarModuleVisible('/tickets')
  const user = useAuthStore((s) => s.auth.user)
  const isLoggedIn = Boolean(user)
  const { data, refetch } = useQuery({
    queryKey: ticketQueryKeys.unread,
    queryFn: getSelfTicketUnread,
    enabled: Boolean(user) && isVisible,
    staleTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (location.pathname !== '/tickets') return
    if (!isLoggedIn || !isVisible) return
    void refetch()
  }, [location.pathname, isLoggedIn, isVisible, refetch])

  return data ?? 0
}
