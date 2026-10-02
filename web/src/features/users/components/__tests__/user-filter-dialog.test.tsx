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
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import type { UserFilterItem } from '../../types'
import { UserFilterDialog } from '../user-filter-dialog'
import { UsersProvider, useUsers } from '../users-provider'

const MATCHED_USER: UserFilterItem = {
  id: 2,
  username: 'idle-user',
  display_name: 'Idle user',
  role: 1,
  status: 1,
  quota: 1000,
  used_quota: 0,
  group: 'default',
  last_login_at: 100,
}

const ROOT_OPERATOR = { id: 1, username: 'root-operator', role: ROLE.SUPER_ADMIN }

function OpenFilterDialog() {
  const users = useUsers()
  useEffect(() => {
    users.setOpen('filter_users')
    // The harness only seeds provider state once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

function renderInProvider(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <UsersProvider>{children}</UsersProvider>
    </QueryClientProvider>
  )
}

// The preview only ever reads; ids_only is the explicit-id query the
// "select all" action uses.
function mockFilter(users: UserFilterItem[] = [MATCHED_USER]) {
  return vi.spyOn(api, 'post').mockImplementation(async (url, body) => {
    if (url !== '/api/user/filter') {
      throw new Error(`Unexpected POST ${url}`)
    }
    const payload = body as { ids_only?: boolean; page?: number }
    if (payload.ids_only) {
      return {
        data: {
          success: true,
          data: {
            ids: users.map((user) => user.id),
            total: users.length,
            truncated: false,
          },
        },
      }
    }
    return {
      data: {
        success: true,
        data: {
          items: users,
          total: users.length,
          page: payload.page ?? 1,
          page_size: 20,
        },
      },
    }
  })
}

// The condition checkbox sits inside its label; query through the label so the
// assertion does not depend on the accessible-name computation of Base UI.
async function toggleCondition(label: string) {
  const labelElement = screen.getByText(label).closest('label')
  expect(labelElement).not.toBeNull()
  await userEvent.click(
    within(labelElement as HTMLElement).getByRole('checkbox')
  )
}

async function previewOnce() {
  await userEvent.click(
    await screen.findByRole('button', { name: 'Preview matching users' })
  )
  await screen.findByText('idle-user')
}

function filterPayload(post: ReturnType<typeof mockFilter>, index = 0) {
  const call = post.mock.calls.filter(([url]) => url === '/api/user/filter')[
    index
  ]
  return call?.[1] as Record<string, unknown>
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
})

it('previews only the enabled condition and converts the threshold', async () => {
  const post = mockFilter()
  renderInProvider(
    <>
      <OpenFilterDialog />
      <UserFilterDialog />
    </>
  )
  await toggleCondition('Last API call time')
  await userEvent.click(screen.getByRole('button', { name: '15 days ago' }))
  await previewOnce()

  const payload = filterPayload(post)
  expect(payload.last_login_before).toBeUndefined()
  expect(payload.page).toBe(1)
  expect(payload.page_size).toBe(20)
  const expected = Math.floor(Date.now() / 1000) - 15 * 86400
  expect(
    Math.abs((payload.last_call_before as number) - expected)
  ).toBeLessThan(60)
})

it('requires both conditions when both are enabled', async () => {
  const post = mockFilter()
  renderInProvider(
    <>
      <OpenFilterDialog />
      <UserFilterDialog />
    </>
  )
  await toggleCondition('Last login time')
  await toggleCondition('Last API call time')
  await previewOnce()

  const payload = filterPayload(post)
  expect(payload.last_login_before).toEqual(expect.any(Number))
  expect(payload.last_call_before).toEqual(expect.any(Number))
})

it('selects all results through an explicit ids query', async () => {
  const post = mockFilter()
  renderInProvider(
    <>
      <OpenFilterDialog />
      <UserFilterDialog />
    </>
  )
  await toggleCondition('Last login time')
  await previewOnce()
  await userEvent.click(
    screen.getByRole('button', { name: 'Select all results (up to 1000)' })
  )
  await waitFor(() =>
    expect(
      post.mock.calls.some(
        ([url, body]) =>
          url === '/api/user/filter' &&
          (body as { ids_only?: boolean }).ids_only === true
      )
    ).toBe(true)
  )
  expect(await screen.findByText('1 selected')).toBeInTheDocument()
})

it('bans the checked users with an explicit id payload', async () => {
  useAuthStore.getState().auth.setUser(ROOT_OPERATOR)
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url === '/api/user/filter') {
      return {
        data: {
          success: true,
          data: { items: [MATCHED_USER], total: 1, page: 1, page_size: 20 },
        },
      }
    }
    if (url === '/api/user/ban_by_ids') {
      return { data: { success: true, data: { banned: 1, failed: [] } } }
    }
    throw new Error(`Unexpected POST ${url}`)
  })
  renderInProvider(
    <>
      <OpenFilterDialog />
      <UserFilterDialog />
    </>
  )
  await toggleCondition('Last login time')
  await previewOnce()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
  await userEvent.click(
    screen.getByRole('button', { name: 'Ban selected users' })
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Disable' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/user/ban_by_ids',
      { ids: [2], ban_reason: 'batch_activity_check' },
      {}
    )
  )
  expect(post.mock.calls.some(([url]) => url === '/api/verify')).toBe(false)
})

it('adjusts the selected users quota by ratio of their own balance', async () => {
  useAuthStore.getState().auth.setUser(ROOT_OPERATOR)
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url === '/api/user/filter') {
      return {
        data: {
          success: true,
          data: { items: [MATCHED_USER], total: 1, page: 1, page_size: 20 },
        },
      }
    }
    if (url === '/api/user/batch_quota') {
      return { data: { success: true, data: { succeeded: 1, failed: [] } } }
    }
    throw new Error(`Unexpected POST ${url}`)
  })
  renderInProvider(
    <>
      <OpenFilterDialog />
      <UserFilterDialog />
    </>
  )
  await toggleCondition('Last login time')
  await previewOnce()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
  await userEvent.click(screen.getByRole('button', { name: 'Adjust quota' }))

  expect(
    await screen.findByText('Add each user by their current quota times 0.5')
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/user/batch_quota',
      expect.objectContaining({
        ids: [2],
        direction: 'add',
        mode: 'ratio',
        ratio: 0.5,
      })
    )
  )
})

it('requires an amount before a fixed adjustment can be confirmed', async () => {
  useAuthStore.getState().auth.setUser(ROOT_OPERATOR)
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url === '/api/user/filter') {
      return {
        data: {
          success: true,
          data: { items: [MATCHED_USER], total: 1, page: 1, page_size: 20 },
        },
      }
    }
    if (url === '/api/user/batch_quota') {
      return { data: { success: true, data: { succeeded: 1, failed: [] } } }
    }
    throw new Error(`Unexpected POST ${url}`)
  })
  renderInProvider(
    <>
      <OpenFilterDialog />
      <UserFilterDialog />
    </>
  )
  await toggleCondition('Last login time')
  await previewOnce()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
  await userEvent.click(screen.getByRole('button', { name: 'Adjust quota' }))
  await userEvent.click(
    await screen.findByRole('button', { name: 'Fixed amount' })
  )

  const confirm = screen.getByRole('button', { name: 'Confirm' })
  expect(confirm).toBeDisabled()
  await userEvent.type(screen.getByRole('spinbutton'), '1')
  expect(confirm).toBeEnabled()
  await userEvent.click(confirm)
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/user/batch_quota',
      expect.objectContaining({ ids: [2], mode: 'fixed', value: 500000 })
    )
  )
})
