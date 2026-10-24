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
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type {
  AIReviewFilters,
  AIReviewRecord,
  AIReviewRecordPage,
  AIReviewStats,
} from '../api-ai-review'
import { AIReviewTab } from '../components/ai-review-tab'

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('@/lib/api', () => ({ api: apiMocks }))
vi.mock('@/components/date-picker', () => ({ DatePicker: () => null }))

const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} } },
  initAsync: false,
})

type RecordParams = AIReviewFilters & { p: number; page_size: number }
const recordsRequest =
  vi.fn<(params: RecordParams) => Promise<AIReviewRecordPage>>()
const statsRequest = vi.fn<() => Promise<AIReviewStats>>()
let client: QueryClient

const alice: AIReviewRecord = {
  id: 1,
  user_id: 7,
  username: 'alice',
  token_id: 0,
  token_name: '',
  ip: '192.0.2.1',
  user_agent: '',
  request_path: '/v1/chat/completions',
  group_name: 'default',
  model_name: 'gpt-4o-mini',
  request_id: 'review-1',
  source: 'sampled',
  matched_words: '[]',
  request_excerpt: '[]',
  verdict: 'flagged',
  category: '',
  confidence: 0,
  reason: '',
  admin_status: 0,
  admin_id: 0,
  admin_username: '',
  admin_comment: '',
  action_taken: 'none',
  handled_at: 0,
  created_at: 1_700_000_000,
}
const safe: AIReviewRecord = {
  ...alice,
  id: 2,
  user_id: 8,
  username: 'bob-safe',
  request_id: 'review-2',
  verdict: 'safe',
  admin_status: 3,
}
const error: AIReviewRecord = {
  ...alice,
  id: 3,
  user_id: 9,
  username: 'carol-error',
  request_id: 'review-3',
  verdict: 'error',
  admin_status: 3,
}
const secondPage: AIReviewRecord = {
  ...alice,
  id: 4,
  username: 'alice-page-two',
  request_id: 'review-4',
}
const newAlice: AIReviewRecord = {
  ...alice,
  id: 5,
  username: 'alice-new',
  request_id: 'review-5',
}
const stats: AIReviewStats = {
  counts: { flagged_0: 1 },
  queue_length: 0,
  dropped_total: 0,
  processed_total: 1,
  flagged_total: 1,
  auto_banned_total: 0,
}

function recordPage(
  items: AIReviewRecord[],
  total: number = items.length,
  page: number = 1
): AIReviewRecordPage {
  return { page, page_size: 20, total, items }
}

function renderReview(): void {
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <AIReviewTab />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

beforeEach(() => {
  // Keep cached keys fresh deterministically without changing timer scheduling.
  vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 10_000, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
  recordsRequest.mockReset()
  statsRequest.mockReset().mockResolvedValue(stats)
  apiMocks.get
    .mockReset()
    .mockImplementation(
      async (url: string, config?: { params?: RecordParams }) => {
        if (url === '/api/ai-review/stats') {
          return { data: { success: true, data: await statsRequest() } }
        }
        if (url === '/api/ai-review' && config?.params) {
          return {
            data: { success: true, data: await recordsRequest(config.params) },
          }
        }
        throw new Error(`Unexpected GET ${url}`)
      }
    )
  apiMocks.post.mockReset().mockRejectedValue(new Error('Unexpected POST'))
})

afterEach(() => {
  cleanup()
  client.clear()
  vi.restoreAllMocks()
  apiMocks.get.mockReset()
  apiMocks.post.mockReset()
  recordsRequest.mockReset()
  statsRequest.mockReset()
})

describe('AI review reset and refresh', () => {
  test('starts with all filters and consecutive Resets fetch newly added safe and error records despite a fresh cache', async () => {
    const user = userEvent.setup()
    let items = [alice]
    recordsRequest.mockImplementation(async () => recordPage(items))
    renderReview()

    await screen.findByRole('button', { name: 'alice' })
    expect(
      screen.getAllByRole('combobox').map((select) => select.textContent)
    ).toEqual(['All', 'All', 'All'])
    expect(recordsRequest).toHaveBeenLastCalledWith({ p: 1, page_size: 20 })

    items = [safe, alice]
    await user.click(screen.getByRole('button', { name: 'Reset' }))

    const safeRow = await screen.findByRole('row', { name: /bob-safe/ })
    expect(within(safeRow).getByText('Safe', { exact: true })).toBeVisible()
    expect(recordsRequest).toHaveBeenLastCalledWith({ p: 1, page_size: 20 })
    expect(
      screen.getAllByRole('combobox').map((select) => select.textContent)
    ).toEqual(['All', 'All', 'All'])

    items = [error, safe, alice]
    await user.click(screen.getByRole('button', { name: 'Reset' }))

    const errorRow = await screen.findByRole('row', { name: /carol-error/ })
    expect(within(errorRow).getByText('Review error')).toBeVisible()
    expect(screen.getByRole('button', { name: 'bob-safe' })).toBeVisible()
    expect(recordsRequest).toHaveBeenLastCalledWith({ p: 1, page_size: 20 })
    expect(
      screen.getAllByRole('combobox').map((select) => select.textContent)
    ).toEqual(['All', 'All', 'All'])
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
  })

  test('Search applies the user filter and Reset clears it, selection and page while refetching the fresh all-records key', async () => {
    const user = userEvent.setup()
    let allItems = [alice, safe]
    recordsRequest.mockImplementation(async (params) => {
      if (params.user === 'alice') {
        return params.p === 2
          ? recordPage([secondPage], 21, 2)
          : recordPage([alice], 21)
      }
      return recordPage(allItems)
    })
    renderReview()
    await screen.findByRole('button', { name: 'bob-safe' })

    await user.type(screen.getByRole('textbox', { name: 'User' }), ' alice ')
    expect(recordsRequest).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'bob-safe' })
      ).not.toBeInTheDocument()
    )
    expect(recordsRequest).toHaveBeenLastCalledWith({
      p: 1,
      page_size: 20,
      user: 'alice',
    })

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByRole('button', { name: 'alice-page-two' })
    await user.click(screen.getByRole('checkbox', { name: 'Select row' }))
    expect(screen.getByText('Selected 1')).toBeVisible()
    allItems = [error, alice, safe]
    await user.click(screen.getByRole('button', { name: 'Reset' }))

    await screen.findByRole('button', { name: 'carol-error' })
    expect(screen.getByRole('button', { name: 'bob-safe' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'alice' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'User' })).toHaveValue('')
    expect(
      screen.getAllByRole('combobox').map((select) => select.textContent)
    ).toEqual(['All', 'All', 'All'])
    expect(screen.getByText('Selected 0')).toBeVisible()
    expect(screen.getByText('1 / 1')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    expect(recordsRequest).toHaveBeenLastCalledWith({ p: 1, page_size: 20 })
  })

  test('Refresh on page two preserves submitted filters, returns to page one and updates rows and pending stats without blanking loading rows', async () => {
    const user = userEvent.setup()
    let releasePageTwo!: (page: AIReviewRecordPage) => void
    const pageTwoResponse = new Promise<AIReviewRecordPage>((resolve) => {
      releasePageTwo = resolve
    })
    let releaseRefresh!: (page: AIReviewRecordPage) => void
    const refreshResponse = new Promise<AIReviewRecordPage>((resolve) => {
      releaseRefresh = resolve
    })
    let refreshing = false
    recordsRequest.mockImplementation(async (params) => {
      if (params.user !== 'alice') return recordPage([safe])
      if (params.p === 2) return pageTwoResponse
      return refreshing ? refreshResponse : recordPage([alice], 21)
    })
    renderReview()
    await screen.findByRole('button', { name: 'bob-safe' })
    await screen.findByText('Pending: 1')
    await user.type(screen.getByRole('textbox', { name: 'User' }), 'alice')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByRole('button', { name: 'alice' })

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() =>
      expect(recordsRequest).toHaveBeenLastCalledWith({
        p: 2,
        page_size: 20,
        user: 'alice',
      })
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    )
    expect(screen.getByRole('button', { name: 'alice' })).toBeVisible()
    expect(
      screen.queryByText('No AI review records found.')
    ).not.toBeInTheDocument()
    await act(async () => {
      releasePageTwo(recordPage([secondPage], 21, 2))
    })
    await screen.findByRole('button', { name: 'alice-page-two' })
    expect(screen.getByText('2 / 2')).toBeVisible()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
    )

    // An unsubmitted edit must not replace the filter used for Refresh.
    await user.clear(screen.getByRole('textbox', { name: 'User' }))
    await user.type(
      screen.getByRole('textbox', { name: 'User' }),
      'unsubmitted-user'
    )
    refreshing = true
    statsRequest.mockResolvedValue({
      ...stats,
      counts: { flagged_0: 7 },
      processed_total: 7,
      flagged_total: 7,
    })
    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() =>
      expect(recordsRequest).toHaveBeenLastCalledWith({
        p: 1,
        page_size: 20,
        user: 'alice',
      })
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    )
    expect(screen.getByRole('table')).toHaveTextContent(/alice/)
    expect(
      screen.queryByText('No AI review records found.')
    ).not.toBeInTheDocument()
    await act(async () => {
      releaseRefresh(recordPage([newAlice, alice], 22))
    })

    await screen.findByRole('button', { name: 'alice-new' })
    expect(await screen.findByText('Pending: 7')).toBeVisible()
    expect(screen.getByText('1 / 2')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'bob-safe' })
    ).not.toBeInTheDocument()
    expect(recordsRequest).toHaveBeenLastCalledWith({
      p: 1,
      page_size: 20,
      user: 'alice',
    })
  })
})
