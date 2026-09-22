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

import { useCooperationAdminPendingCount } from '../hooks/use-cooperation-admin-stats'

const getCooperationStatsMock = vi.fn()
const visibilityMock = vi.hoisted(() => ({ visible: true }))

vi.mock('@/hooks/use-sidebar-config', () => ({
  useIsSidebarModuleVisible: () => visibilityMock.visible,
}))

vi.mock('../api', () => ({
  cooperationQueryKeys: {
    adminStats: ['cooperation', 'adminStats'],
  },
  getCooperationStats: () => getCooperationStatsMock(),
}))

function renderPendingCount() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderHook(() => useCooperationAdminPendingCount(), {
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

describe('useCooperationAdminPendingCount', () => {
  beforeEach(() => {
    getCooperationStatsMock.mockReset()
    visibilityMock.visible = true
    useAuthStore.setState((state) => ({
      auth: { ...state.auth, user: null },
    }))
  })

  test('returns 0 and never fetches while the cooperation module is hidden', async () => {
    visibilityMock.visible = false
    signInAsAdmin()

    const { result } = renderPendingCount()

    await waitFor(() => expect(result.current).toBe(0))
    expect(getCooperationStatsMock).not.toHaveBeenCalled()
  })

  test('returns 0 and never fetches for a non-admin user', async () => {
    useAuthStore.setState((state) => ({
      auth: {
        ...state.auth,
        user: { id: 2, username: 'alice', role: 1 } as never,
      },
    }))

    const { result } = renderPendingCount()

    await waitFor(() => expect(result.current).toBe(0))
    expect(getCooperationStatsMock).not.toHaveBeenCalled()
  })

  test('returns the server pending count for an admin with the module visible', async () => {
    getCooperationStatsMock.mockResolvedValue({
      pending: 4,
      approved: 1,
      rejected: 0,
      total: 5,
    })
    signInAsAdmin()

    const { result } = renderPendingCount()

    await waitFor(() => expect(result.current).toBe(4))
    expect(getCooperationStatsMock).toHaveBeenCalledTimes(1)
  })
})
