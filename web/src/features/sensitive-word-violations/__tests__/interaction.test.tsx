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

import { RiskControlCenter } from '..'

const apiMocks = vi.hoisted(() => ({
  banProbeGuardUser: vi.fn(),
  banSensitiveWordViolationUser: vi.fn(),
  deleteProbeGuardLogs: vi.fn(),
  deleteSensitiveWordViolations: vi.fn(),
  getProbeGuardLogUsers: vi.fn(),
  getProbeGuardLogs: vi.fn(),
  getSensitiveWordViolationUsers: vi.fn(),
  getSensitiveWordViolations: vi.fn(),
  resetProbeGuardCount: vi.fn(),
  resetSensitiveWordViolationCount: vi.fn(),
}))

vi.mock('../api', () => apiMocks)
vi.mock('@/components/date-picker', () => ({
  DatePicker: () => <button type='button'>Pick a date</button>,
}))

function renderViolations() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <RiskControlCenter />
    </QueryClientProvider>
  )
}

const user = {
  user_id: 42,
  username: 'alice',
  violation_count: 3,
  trigger_count: 5,
  highlighted: true,
  latest_created_at: 100,
}

const violation = {
  id: 1,
  user_id: 42,
  username: 'alice',
  ip: '192.0.2.1',
  user_agent: 'Vitest',
  request_path: '/v1/chat/completions',
  request_content: 'a secret request',
  matched_words: '["secret"]',
  match_locations: '[]',
  trigger_count: 5,
  highlighted: true,
  created_at: 100,
}

async function expandUserRow() {
  fireEvent.click(await screen.findByRole('button', { name: /alice/ }))
  return screen.findByRole('checkbox', { name: 'Select row' })
}

describe('sensitive-word violation interactions', () => {
  beforeEach(() => {
    apiMocks.banProbeGuardUser.mockResolvedValue({})
    apiMocks.banSensitiveWordViolationUser.mockResolvedValue({})
    apiMocks.deleteProbeGuardLogs.mockResolvedValue({ deleted: 0 })
    apiMocks.deleteSensitiveWordViolations.mockResolvedValue({ deleted: 1 })
    apiMocks.getProbeGuardLogUsers.mockResolvedValue({
      page: 1,
      page_size: 20,
      total: 0,
      items: [],
    })
    apiMocks.getProbeGuardLogs.mockResolvedValue({
      page: 1,
      page_size: 20,
      total: 0,
      items: [],
    })
    apiMocks.getSensitiveWordViolationUsers.mockResolvedValue({
      page: 1,
      page_size: 20,
      total: 1,
      items: [user],
    })
    apiMocks.getSensitiveWordViolations.mockResolvedValue({
      page: 1,
      page_size: 20,
      total: 1,
      items: [violation],
    })
    apiMocks.resetProbeGuardCount.mockResolvedValue({})
    apiMocks.resetSensitiveWordViolationCount.mockResolvedValue({})
  })

  test('searching without filters requests the user list again', async () => {
    renderViolations()
    await waitFor(() =>
      expect(apiMocks.getSensitiveWordViolationUsers).toHaveBeenCalledTimes(1)
    )

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() =>
      expect(apiMocks.getSensitiveWordViolationUsers).toHaveBeenCalledTimes(2)
    )
    expect(apiMocks.getSensitiveWordViolationUsers).toHaveBeenLastCalledWith(
      1,
      20,
      {}
    )
  })

  test('highlighted users show a badge in the user list', async () => {
    renderViolations()

    expect(await screen.findByRole('button', { name: /alice/ })).toHaveTextContent(
      'Highlighted'
    )
  })

  test('expanding a user loads only that user violations', async () => {
    renderViolations()

    await expandUserRow()

    expect(apiMocks.getSensitiveWordViolations).toHaveBeenCalledWith(1, 20, {
      user_id: 42,
    })
    expect(screen.getByRole('button', { name: /alice/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  test('reset count sends the expanded user id', async () => {
    renderViolations()
    await expandUserRow()

    fireEvent.click(screen.getByRole('button', { name: 'Reset count' }))

    await waitFor(() =>
      expect(apiMocks.resetSensitiveWordViolationCount).toHaveBeenCalledWith(42)
    )
  })

  test('deleting selected records asks for confirmation before calling the API', async () => {
    renderViolations()
    const rowCheckbox = await expandUserRow()

    fireEvent.click(rowCheckbox)
    fireEvent.click(screen.getByRole('button', { name: 'Delete records' }))

    expect(await screen.findByRole('dialog')).toBeVisible()
    expect(apiMocks.deleteSensitiveWordViolations).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(apiMocks.deleteSensitiveWordViolations).toHaveBeenCalledWith({
        ids: [1],
      })
    )
  })

  test('the request content is only revealed in the details dialog, not on hover', async () => {
    renderViolations()
    await expandUserRow()

    const contentButton = screen.getByRole('button', { name: 'a secret request' })
    expect(contentButton).not.toHaveAttribute('title')

    fireEvent.click(contentButton)

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'a secret request'
    )
  })

  test('the delete button stays disabled while nothing is selected', async () => {
    renderViolations()
    await expandUserRow()

    expect(screen.getByRole('button', { name: 'Delete records' })).toBeDisabled()
  })
})
