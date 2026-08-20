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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { SensitiveWordViolations } from '..'

const apiMocks = vi.hoisted(() => ({
  banSensitiveWordViolationUser: vi.fn(),
  getSensitiveWordViolations: vi.fn(),
  resetSensitiveWordViolationCount: vi.fn(),
}))
const copyToClipboard = vi.hoisted(() => vi.fn())

vi.mock('../api', () => apiMocks)
vi.mock('@/lib/copy-to-clipboard', () => ({ copyToClipboard }))
vi.mock('@/components/date-picker', () => ({
  DatePicker: () => <button type='button'>Pick a date</button>,
}))

function renderViolations() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <SensitiveWordViolations />
    </QueryClientProvider>
  )
}

const violation = {
  id: 1,
  user_id: 42,
  username: 'alice',
  ip: '192.0.2.1',
  user_agent: 'Vitest',
  request_path: '/v1/chat',
  request_content: 'secret request',
  matched_words: '["secret"]',
  match_locations: '[]',
  trigger_count: 5,
  highlighted: true,
  created_at: 100,
}

describe('sensitive-word violation interactions', () => {
  beforeEach(() => {
    apiMocks.banSensitiveWordViolationUser.mockReset()
    apiMocks.getSensitiveWordViolations.mockReset()
    apiMocks.getSensitiveWordViolations.mockResolvedValue({
      page: 1,
      page_size: 100,
      total: 0,
      items: [],
    })
    apiMocks.resetSensitiveWordViolationCount.mockReset()
    apiMocks.resetSensitiveWordViolationCount.mockResolvedValue({})
    copyToClipboard.mockReset()
    copyToClipboard.mockResolvedValue(true)
  })

  test('searching without filters requests the latest records again', async () => {
    renderViolations()
    await waitFor(() =>
      expect(apiMocks.getSensitiveWordViolations).toHaveBeenCalledTimes(1)
    )

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() =>
      expect(apiMocks.getSensitiveWordViolations).toHaveBeenCalledTimes(2)
    )
    expect(apiMocks.getSensitiveWordViolations).toHaveBeenLastCalledWith(
      1,
      100,
      {}
    )
  })

  test('refreshing requests the current records again', async () => {
    renderViolations()
    await waitFor(() =>
      expect(apiMocks.getSensitiveWordViolations).toHaveBeenCalledTimes(1)
    )

    const refreshButton = screen.getByRole('button', { name: 'Refresh' })
    await waitFor(() => expect(refreshButton).toBeEnabled())
    fireEvent.click(refreshButton)

    await waitFor(() =>
      expect(apiMocks.getSensitiveWordViolations).toHaveBeenCalledTimes(2)
    )
  })

  test('highlighted users show a badge without coloring the entire row', async () => {
    apiMocks.getSensitiveWordViolations.mockResolvedValue({
      page: 1,
      page_size: 100,
      total: 1,
      items: [violation],
    })
    renderViolations()

    const user = await screen.findByText('alice')
    expect(screen.getByText('Highlighted')).toBeVisible()
    expect(user.closest('tr')).not.toHaveClass('bg-destructive/10')
  })

  test('reset count sends the selected user id', async () => {
    apiMocks.getSensitiveWordViolations.mockResolvedValue({
      page: 1,
      page_size: 100,
      total: 1,
      items: [violation],
    })
    renderViolations()

    fireEvent.click(await screen.findByRole('button', { name: 'Reset count' }))

    await waitFor(() =>
      expect(apiMocks.resetSensitiveWordViolationCount).toHaveBeenCalled()
    )
    expect(apiMocks.resetSensitiveWordViolationCount.mock.calls[0]?.[0]).toBe(
      42
    )
  })

  test('request details copy the complete request content', async () => {
    apiMocks.getSensitiveWordViolations.mockResolvedValue({
      page: 1,
      page_size: 100,
      total: 1,
      items: [violation],
    })
    renderViolations()

    fireEvent.click(
      await screen.findByRole('button', {
        name: '/v1/chat: secret request',
      })
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Copy to clipboard' })
    )

    await waitFor(() =>
      expect(copyToClipboard).toHaveBeenCalledWith('secret request')
    )
  })
})
