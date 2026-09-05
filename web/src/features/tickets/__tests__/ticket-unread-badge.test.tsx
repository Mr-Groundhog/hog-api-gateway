/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { useTicketUnread } from '../hooks/use-ticket-unread'

const getSelfTicketUnreadMock = vi.fn()
const locationMock = vi.hoisted(() => ({ pathname: '/dashboard' }))

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => locationMock,
}))

vi.mock('../api', () => ({
  ticketQueryKeys: {
    unread: ['tickets', 'unread'],
  },
  getSelfTicketUnread: () => getSelfTicketUnreadMock(),
}))

vi.mock('@/hooks/use-sidebar-config', () => ({
  useIsSidebarModuleVisible: vi.fn(() => true),
}))

function renderUnreadHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderHook(() => useTicketUnread(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}

describe('useTicketUnread', () => {
  beforeEach(() => {
    getSelfTicketUnreadMock.mockReset()
    locationMock.pathname = '/dashboard'
    useAuthStore.setState((state) => ({
      auth: { ...state.auth, user: null },
    }))
  })

  test('returns 0 and never fetches while logged out', async () => {
    const { result } = renderUnreadHook()

    await waitFor(() => expect(result.current).toBe(0))
    expect(getSelfTicketUnreadMock).not.toHaveBeenCalled()
  })

  test('returns the server unread count for a logged-in user', async () => {
    getSelfTicketUnreadMock.mockResolvedValue(3)
    useAuthStore.setState((state) => ({
      auth: {
        ...state.auth,
        user: { id: 1, username: 'alice', role: 1 } as never,
      },
    }))

    const { result } = renderUnreadHook()
    await waitFor(() => expect(result.current).toBe(3))
    expect(getSelfTicketUnreadMock).toHaveBeenCalledTimes(1)
  })

  test('refetches the unread count when the user enters the ticket page', async () => {
    getSelfTicketUnreadMock.mockResolvedValue(1)
    useAuthStore.setState((state) => ({
      auth: {
        ...state.auth,
        user: { id: 1, username: 'alice', role: 1 } as never,
      },
    }))

    const { result, rerender } = renderUnreadHook()
    await waitFor(() => expect(result.current).toBe(1))
    expect(getSelfTicketUnreadMock).toHaveBeenCalledTimes(1)

    locationMock.pathname = '/tickets'
    rerender()

    await waitFor(() =>
      expect(getSelfTicketUnreadMock).toHaveBeenCalledTimes(2)
    )
  })

  test('falls back to 0 when the count request fails', async () => {
    getSelfTicketUnreadMock.mockRejectedValue(new Error('network down'))
    useAuthStore.setState((state) => ({
      auth: {
        ...state.auth,
        user: { id: 1, username: 'alice', role: 1 } as never,
      },
    }))

    const { result } = renderUnreadHook()
    await waitFor(() => expect(result.current).toBe(0))
  })
})
