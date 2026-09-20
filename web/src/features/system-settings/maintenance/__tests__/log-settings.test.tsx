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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { OperationsSettings } from '../../operations'

let queryClient: QueryClient
let options: Record<string, string>

async function renderLogMaintenance() {
  const root = createRootRoute()
  const authenticated = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
  })
  const logRoute = createRoute({
    getParentRoute: () => authenticated,
    path: '/system-settings/operations/$section',
    component: OperationsSettings,
  })
  const router = createRouter({
    routeTree: root.addChildren([authenticated.addChildren([logRoute])]),
    history: createMemoryHistory({
      initialEntries: ['/system-settings/operations/logs'],
    }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await act(() => router.load())
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  options = {
    LogConsumeEnabled: 'true',
    'log_setting.response_model_user_visible': 'false',
  }
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/option/') {
      return {
        data: {
          success: true,
          data: Object.entries(options).map(([key, value]) => ({ key, value })),
        },
      }
    }
    if (url === '/api/performance/logs') {
      return {
        data: {
          success: true,
          data: { enabled: false, log_dir: '', file_count: 0, total_size: 0 },
        },
      }
    }
    return { data: { success: true, data: null } }
  })
})

afterEach(() => {
  cleanup()
  queryClient.clear()
})

describe('log maintenance settings', () => {
  it('reflects the stored upstream response model visibility option', async () => {
    await renderLogMaintenance()

    expect(
      await screen.findByRole('switch', {
        name: 'Show upstream response model to users',
      })
    ).not.toBeChecked()
  })

  it('enabling the upstream response model switch writes that option only', async () => {
    await renderLogMaintenance()

    await userEvent.click(
      await screen.findByRole('switch', {
        name: 'Show upstream response model to users',
      })
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Save log settings' })
    )

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledExactlyOnceWith('/api/option/', {
        key: 'log_setting.response_model_user_visible',
        value: true,
      })
    )
  })

  it('disabling quota usage logging writes LogConsumeEnabled only', async () => {
    await renderLogMaintenance()

    await userEvent.click(
      await screen.findByRole('switch', { name: 'Record quota usage' })
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Save log settings' })
    )

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledExactlyOnceWith('/api/option/', {
        key: 'LogConsumeEnabled',
        value: false,
      })
    )
  })
})
