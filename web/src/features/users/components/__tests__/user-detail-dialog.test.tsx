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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import type { User } from '../../types'

const getUser = vi.fn()

vi.mock('../../api', () => ({
  getUser: (id: number) => getUser(id),
}))

const { UserDetailDialog } = await import('../dialogs/user-detail-dialog')

const BASE_USER: User = {
  id: 42,
  username: 'alice',
  display_name: 'Alice Liddell',
  email: 'alice@example.com',
  quota: 500000,
  used_quota: 1000000,
  request_count: 1234,
  group: 'vip',
  status: 1,
  role: 1,
  remark: 'trusted',
  aff_code: 'AFF42',
  aff_count: 3,
  github_id: 'alice-gh',
  created_at: 1700000000,
  last_login_ip: '203.0.113.7',
}

function renderDialog(user: User | null, open = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <UserDetailDialog open={open} onOpenChange={() => {}} user={user} />
    </QueryClientProvider>
  )
}

describe('user detail dialog', () => {
  test('shows the row data immediately and then the refreshed API values', async () => {
    getUser.mockResolvedValue({
      success: true,
      data: { ...BASE_USER, remark: 'refreshed remark' },
    })

    renderDialog(BASE_USER)

    expect(await screen.findByText('#42 · alice')).toBeInTheDocument()
    expect(screen.getByText('Alice Liddell')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByText('trusted')).toBeInTheDocument()

    await waitFor(() =>
      expect(screen.getByText('refreshed remark')).toBeInTheDocument()
    )
    expect(getUser).toHaveBeenCalledWith(42)
  })

  test('keeps the row data visible when the detail request fails', async () => {
    getUser.mockResolvedValue({ success: false, message: 'no permission' })

    renderDialog(BASE_USER)

    await waitFor(() => expect(getUser).toHaveBeenCalledWith(42))
    expect(screen.getByText('trusted')).toBeInTheDocument()
    expect(screen.getByText('203.0.113.7')).toBeInTheDocument()
  })

  test('falls back to placeholders for unset optional fields', async () => {
    getUser.mockResolvedValue({ success: true, data: undefined })

    renderDialog({
      ...BASE_USER,
      display_name: '',
      email: undefined,
      remark: undefined,
      github_id: undefined,
      last_login_ip: undefined,
    })

    // Email, GitHub ID and the remaining bindings are all unbound.
    await waitFor(() =>
      expect(screen.getAllByText('Not bound').length).toBeGreaterThan(1)
    )
    expect(screen.getByText('No Inviter')).toBeInTheDocument()
  })

  test('does not request user details while the dialog is closed', () => {
    renderDialog(BASE_USER, false)

    expect(getUser).not.toHaveBeenCalled()
  })

  test('renders an empty state and no request when no user is selected', () => {
    renderDialog(null)

    expect(screen.getByText('No user information available')).toBeInTheDocument()
    expect(getUser).not.toHaveBeenCalled()
  })

  test('closes through the footer button', async () => {
    getUser.mockResolvedValue({ success: true, data: BASE_USER })
    const onOpenChange = vi.fn()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <UserDetailDialog open onOpenChange={onOpenChange} user={BASE_USER} />
      </QueryClientProvider>
    )

    // The dialog also renders an icon-only close control with the same name.
    const footerClose = screen
      .getAllByRole('button', { name: 'Close' })
      .find((button) => button.querySelector('.sr-only') === null)
    expect(footerClose).toBeDefined()

    await userEvent.click(footerClose as HTMLElement)

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('packs four fields per row and lets free text span two columns', async () => {
    getUser.mockResolvedValue({ success: true, data: BASE_USER })

    renderDialog(BASE_USER)

    const section = (await screen.findByText('Basic Information')).closest(
      'section'
    )
    expect(section?.lastElementChild).toHaveClass(
      'grid',
      'grid-cols-2',
      'sm:grid-cols-4'
    )
    expect(screen.getByText('Remark').parentElement).toHaveClass(
      'sm:col-span-2'
    )
  })
})
