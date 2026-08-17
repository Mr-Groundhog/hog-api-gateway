/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the License.
*/

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Lottery } from '..'

const apiMocks = vi.hoisted(() => ({
  drawLottery: vi.fn(),
  getTodayLotteryRecords: vi.fn(),
  getLotteryConfig: vi.fn(),
  getLotteryStatus: vi.fn(),
  getMyLotteryRecords: vi.fn(),
}))

vi.mock('../api', () => apiMocks)
vi.mock('@hugeicons/core-free-icons', () => ({
  Clock01Icon: {},
  GiftIcon: {},
  InformationCircleIcon: {},
  Loading03Icon: {},
  RefreshIcon: {},
  SparklesIcon: {},
  TicketStarIcon: {},
  Cancel01Icon: {},
}))
vi.mock('@hugeicons/react', () => ({
  HugeiconsIcon: () => null,
}))

function renderLottery() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <Lottery />
    </QueryClientProvider>
  )
}

describe('lottery interaction', () => {
  beforeEach(() => {
    apiMocks.drawLottery.mockReset()
    apiMocks.getTodayLotteryRecords.mockReset()
    apiMocks.getTodayLotteryRecords.mockResolvedValue([])
    apiMocks.getLotteryConfig.mockReset()
    apiMocks.getLotteryConfig.mockResolvedValue([
      { code: 'first', name: 'First prize', label: 'Brand gift box', icon: '01', tone: 'red', quotaAmount: 500, sortOrder: 1 },
      { code: 'second', name: 'Second prize', label: 'Coffee voucher', icon: '02', tone: 'gold', quotaAmount: 100, sortOrder: 2 },
      { code: 'third', name: 'Third prize', label: '500 credits', icon: '500', tone: 'cream', quotaAmount: 0, sortOrder: 3 },
      { code: 'lucky', name: 'Lucky prize', label: '100 credits', icon: '100', tone: 'cream', quotaAmount: 0, sortOrder: 4 },
      { code: 'thanks', name: 'Thanks for joining', label: 'Better luck next time', icon: '--', tone: 'muted', quotaAmount: 0, sortOrder: 5 },
      { code: 'surprise', name: 'Surprise prize', label: 'Limited sticker', icon: 'S', tone: 'gold', quotaAmount: 0, sortOrder: 6 },
      { code: 'retry', name: 'Lucky charm', label: 'A little extra luck', icon: 'R', tone: 'red', quotaAmount: 0, sortOrder: 7 },
      { code: 'special', name: 'Special prize', label: 'Movie voucher', icon: 'V', tone: 'cream', quotaAmount: 0, sortOrder: 8 },
    ])
    apiMocks.getLotteryStatus.mockReset()
    apiMocks.getLotteryStatus.mockResolvedValue({
      remaining: 1,
      daily_limit: 1,
      my_draw: null,
      rank: null,
    })
    apiMocks.getMyLotteryRecords.mockReset()
    apiMocks.getMyLotteryRecords.mockResolvedValue([])
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string): MediaQueryList => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    })
  })

  it('sends one draw request for repeated clicks and disables drawing after success', async () => {
    let resolveDraw: (result: object) => void = () => undefined
    apiMocks.drawLottery.mockReturnValue(
      new Promise((resolve) => {
        resolveDraw = resolve
      })
    )
    renderLottery()
    const drawButton = screen.getByRole('button', { name: /Start draw/i })

    fireEvent.click(drawButton)
    fireEvent.click(drawButton)

    await waitFor(() => expect(apiMocks.drawLottery).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(drawButton).toBeDisabled())

    resolveDraw({
      prizeCode: 'first',
      prizeName: 'First prize',
      prizeLabel: 'Brand gift box',
      prizeIcon: '01',
      prizeTone: 'red',
      boardIndex: 0,
    })

    expect(await screen.findByRole('dialog')).toBeVisible()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Draw completed/i, hidden: true })
      ).toBeDisabled()
    )
  })
})
