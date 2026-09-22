/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { formatTimestampToDate } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { AdminCampaigns } from '../admin-campaigns'
import type { AdminWelfareAirdrop } from '../api'

const getAllWelfareAirdropsMock = vi.fn()

vi.mock('../api', () => ({
  welfareAirdropQueryKeys: { admin: ['welfare-airdrop', 'admin'] },
  getAllWelfareAirdrops: () => getAllWelfareAirdropsMock(),
  updateWelfareAirdropStatus: vi.fn(),
  deleteWelfareAirdrop: vi.fn(),
}))

function campaign(
  overrides: Partial<AdminWelfareAirdrop>
): AdminWelfareAirdrop {
  return {
    id: 1,
    name: 'Limited airdrop',
    description: '',
    quota: 500000,
    total_count: 10,
    claimed_count: 2,
    per_user_limit: 1,
    start_time: 0,
    end_time: 0,
    created_time: 1767225600,
    status: 1,
    batch_id: 'batch-1',
    ...overrides,
  }
}

function renderAdminCampaigns() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminCampaigns />
    </QueryClientProvider>
  )
}

describe('AdminCampaigns campaign period', () => {
  beforeEach(() => {
    getAllWelfareAirdropsMock.mockReset()
    useAuthStore.setState((state) => ({
      auth: {
        ...state.auth,
        user: { id: 1, username: 'admin', role: 10 } as never,
      },
    }))
  })

  test('renders the campaign creation and end time as one range', async () => {
    const createdTime = 1767225600
    const endTime = 1769904000
    getAllWelfareAirdropsMock.mockResolvedValue([
      campaign({ created_time: createdTime, end_time: endTime }),
    ])

    renderAdminCampaigns()

    expect(
      await screen.findByText(
        `Campaign period: ${formatTimestampToDate(createdTime)} ~ ${formatTimestampToDate(endTime)}`
      )
    ).toBeInTheDocument()
  })

  test('labels an unlimited campaign deadline instead of rendering a zero date', async () => {
    const createdTime = 1767225600
    getAllWelfareAirdropsMock.mockResolvedValue([
      campaign({ created_time: createdTime, end_time: 0 }),
    ])

    renderAdminCampaigns()

    expect(
      await screen.findByText(
        `Campaign period: ${formatTimestampToDate(createdTime)} ~ No expiry`
      )
    ).toBeInTheDocument()
  })
})
