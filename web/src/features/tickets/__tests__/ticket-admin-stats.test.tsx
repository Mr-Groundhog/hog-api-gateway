/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import {
  useTicketAdminPendingCount,
  useTicketAdminStats,
} from '../hooks/use-ticket-admin-stats'

const getAdminTicketStatsMock = vi.fn()
const visibilityMock = vi.hoisted(() => ({ visible: true }))

vi.mock('@/hooks/use-sidebar-config', () => ({
  useIsSidebarModuleVisible: () => visibilityMock.visible,
}))

vi.mock('../api', () => ({
  ticketQueryKeys: {
    adminStats: ['tickets', 'adminStats'],
  },
  getAdminTicketStats: () => getAdminTicketStatsMock(),
}))

function renderHookWithQueryClient<T>(hook: () => T) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderHook(hook, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}

function signInAsAdmin() {
  useAuthStore.setState((state) => ({
    auth: {
      ...state.auth,
      user: { id: 1, username: 'admin', role: 10 } as never,
    },
  }))
}

describe('useTicketAdminPendingCount', () => {
  beforeEach(() => {
    getAdminTicketStatsMock.mockReset()
    getAdminTicketStatsMock.mockResolvedValue({ pending: 3 })
    visibilityMock.visible = true
    useAuthStore.setState((state) => ({
      auth: { ...state.auth, user: null },
    }))
  })

  test('returns 0 and never fetches while the ticket management module is hidden', async () => {
    visibilityMock.visible = false
    signInAsAdmin()

    const { result } = renderHookWithQueryClient(useTicketAdminPendingCount)

    await waitFor(() => expect(result.current).toBe(0))
    expect(getAdminTicketStatsMock).not.toHaveBeenCalled()
  })

  test('returns 0 and never fetches for a non-admin user', async () => {
    useAuthStore.setState((state) => ({
      auth: {
        ...state.auth,
        user: { id: 2, username: 'alice', role: 1 } as never,
      },
    }))

    const { result } = renderHookWithQueryClient(useTicketAdminPendingCount)

    await waitFor(() => expect(result.current).toBe(0))
    expect(getAdminTicketStatsMock).not.toHaveBeenCalled()
  })

  test('returns the server pending count for an admin with the module visible', async () => {
    signInAsAdmin()

    const { result } = renderHookWithQueryClient(useTicketAdminPendingCount)

    await waitFor(() => expect(result.current).toBe(3))
    expect(getAdminTicketStatsMock).toHaveBeenCalledTimes(1)
  })

  test('keeps fetching for the in-page stats bar while the module is hidden', async () => {
    visibilityMock.visible = false
    signInAsAdmin()

    const { result } = renderHookWithQueryClient(useTicketAdminStats)

    await waitFor(() => expect(result.current.data).toEqual({ pending: 3 }))
  })
})
