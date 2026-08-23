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
import { fireEvent, render, screen } from '@testing-library/react'
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

function renderRiskControlCenter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <RiskControlCenter />
    </QueryClientProvider>
  )
}

describe('risk control center tabs', () => {
  beforeEach(() => {
    apiMocks.banProbeGuardUser.mockResolvedValue({})
    apiMocks.banSensitiveWordViolationUser.mockResolvedValue({})
    apiMocks.deleteProbeGuardLogs.mockResolvedValue({ deleted: 0 })
    apiMocks.deleteSensitiveWordViolations.mockResolvedValue({ deleted: 0 })
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
      total: 0,
      items: [],
    })
    apiMocks.getSensitiveWordViolations.mockResolvedValue({
      page: 1,
      page_size: 20,
      total: 0,
      items: [],
    })
    apiMocks.resetProbeGuardCount.mockResolvedValue({})
    apiMocks.resetSensitiveWordViolationCount.mockResolvedValue({})
  })

  test('opening the risk control center shows both tabs and the triggers table first', () => {
    renderRiskControlCenter()

    expect(screen.getByRole('tab', { name: 'Sensitive Word Triggers' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Liveness Check List' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(screen.getByText('Review blocked requests and repeated violations.')).toBeInTheDocument()
  })

  test('switching to the liveness tab loads probe guard data and switching back restores the triggers table', async () => {
    apiMocks.getProbeGuardLogUsers.mockResolvedValue({
      page: 1,
      page_size: 20,
      total: 1,
      items: [
        {
          user_id: 7,
          username: 'probe_hunter',
          record_count: 3,
          dry_run_count: 2,
          trigger_count: 1,
          max_distinct: 8,
          latest_models: '["gpt-4o","claude-3-5-sonnet","gemini-2.0-flash","deepseek-chat","kimi-k2"]',
          latest_distinct: 5,
          latest_ip: '203.0.113.10',
          latest_created_at: 1786993200,
        },
      ],
    })

    renderRiskControlCenter()

    fireEvent.click(screen.getByRole('tab', { name: 'Liveness Check List' }))

    expect(await screen.findByText('probe_hunter')).toBeInTheDocument()
    expect(screen.getByText('gpt-4o')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('203.0.113.10')).toBeInTheDocument()
    expect(screen.getByText('Track accounts that repeatedly probe key validity.')).toBeInTheDocument()
    expect(screen.queryByText('Review blocked requests and repeated violations.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Sensitive Word Triggers' }))

    expect(screen.getByText('Review blocked requests and repeated violations.')).toBeInTheDocument()
    expect(screen.queryByText('probe_hunter')).not.toBeInTheDocument()
  })
})
