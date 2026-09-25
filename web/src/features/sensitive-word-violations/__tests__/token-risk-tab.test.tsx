/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { TokenRiskUserSummary } from '../api-token-risk'
import { TokenRiskTab } from '../components/token-risk-tab'

const apiMocks = vi.hoisted(() => ({
  banTokenRiskUser: vi.fn(),
  deleteTokenRiskEvents: vi.fn(),
  getTokenRiskUsers: vi.fn(),
}))

vi.mock('../api-token-risk', () => apiMocks)

const crossUserEvidence = JSON.stringify({
  fingerprint: 'abcdef0123456789',
  user_agent: 'claude-cli/1.0.34 (external, cli)',
  client_version: '1.0.34',
  platform: 'macOS',
  user_ids: [7, 12, 305],
  usernames: ['alice', 'bob', '#305'],
  user_count: 3,
  threshold: 3,
})

const burstEvidence = JSON.stringify({
  distinct_fingerprints: 18,
  valid_fingerprints: 14,
  threshold: 10,
  fingerprints: [
    {
      fingerprint: '0123456789abcdef',
      requests: 12,
      user_agent: 'claude-cli/1.0.34 (external, cli)',
    },
    {
      fingerprint: 'fedcba9876543210',
      requests: 9,
      user_agent: 'OpenAI/Python 1.58.1',
      client_version: '1.58.1',
    },
  ],
})

const summaryBase: TokenRiskUserSummary = {
  user_id: 7,
  username: 'alice',
  event_count: 4,
  concurrent_fp_count: 0,
  single_fp_count: 0,
  fp_burst_count: 0,
  fp_cross_user_count: 1,
  pending_count: 4,
  involved_token_count: 1,
  latest_event_time: 1_700_000_000,
  latest_event_type: 'fp_cross_user',
  latest_evidence: crossUserEvidence,
  signals: [
    {
      event_type: 'fp_cross_user',
      evidence: crossUserEvidence,
      created_time: 1_700_000_000,
    },
  ],
}

const burstSummary: TokenRiskUserSummary = {
  ...summaryBase,
  fp_burst_count: 1,
  fp_cross_user_count: 0,
  latest_event_type: 'fp_burst',
  latest_evidence: burstEvidence,
  signals: [
    {
      event_type: 'fp_burst',
      evidence: burstEvidence,
      created_time: 1_700_000_000,
    },
  ],
}

function renderTokenRiskTab(items: TokenRiskUserSummary[]) {
  apiMocks.getTokenRiskUsers.mockResolvedValue({
    page: 1,
    page_size: 20,
    total: items.length,
    items,
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TokenRiskTab />
    </QueryClientProvider>
  )
}

/** 表格里只有单行摘要，明细必须点击摘要后在弹窗中查看。 */
async function openEvidenceDialog(summaryName: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name: summaryName }))
  return within(await screen.findByRole('dialog'))
}

describe('token risk evidence column', () => {
  beforeEach(() => {
    apiMocks.banTokenRiskUser.mockResolvedValue({})
    apiMocks.deleteTokenRiskEvents.mockResolvedValue({ deleted: 0 })
  })

  test('keeps the evidence cell on a single summary line', async () => {
    renderTokenRiskTab([burstSummary])

    const summary = await screen.findByRole('button', {
      name: /Distinct fingerprints in one day: 18/,
    })

    expect(summary).toHaveTextContent('Threshold: 10')
    expect(summary).not.toHaveTextContent('0123456789abcdef')
    expect(screen.queryByText('0123456789abcdef')).not.toBeInTheDocument()
  })

  test('reveals every client behind a fingerprint burst once opened', async () => {
    renderTokenRiskTab([burstSummary])

    const dialog = await openEvidenceDialog(/Distinct fingerprints in one day/)

    expect(dialog.getByText('0123456789abcdef')).toBeInTheDocument()
    expect(
      dialog.getByText('claude-cli/1.0.34 (external, cli)')
    ).toBeInTheDocument()
    expect(dialog.getByText('12')).toBeInTheDocument()
    expect(dialog.getByText('OpenAI/Python 1.58.1')).toBeInTheDocument()
    expect(dialog.getByText('9')).toBeInTheDocument()
    expect(dialog.getAllByText('Requests in one day:')).toHaveLength(2)
  })

  test('names the accounts sharing the fingerprint for a cross-user event', async () => {
    renderTokenRiskTab([summaryBase])

    const dialog = await openEvidenceDialog(
      /Usernames seen with this fingerprint/
    )

    expect(dialog.getByText('alice, bob, #305')).toBeInTheDocument()
    expect(dialog.getByText('7, 12, 305')).toBeInTheDocument()
  })

  test('identifies the client behind the shared fingerprint', async () => {
    renderTokenRiskTab([summaryBase])

    const dialog = await openEvidenceDialog(
      /Usernames seen with this fingerprint/
    )

    expect(
      dialog.getByText('claude-cli/1.0.34 (external, cli)')
    ).toBeInTheDocument()
    expect(dialog.getByText('1.0.34')).toBeInTheDocument()
    expect(dialog.getByText('macOS')).toBeInTheDocument()
  })

  test('keeps cross-user accounts in the summary when another signal is latest', async () => {
    const concurrentEvidence = JSON.stringify({
      concurrent_fingerprints: 4,
      threshold: 3,
    })
    renderTokenRiskTab([
      {
        ...summaryBase,
        event_count: 5,
        concurrent_fp_count: 1,
        latest_event_type: 'concurrent_fp',
        latest_evidence: concurrentEvidence,
        signals: [
          {
            event_type: 'concurrent_fp',
            evidence: concurrentEvidence,
            created_time: 1_700_000_100,
          },
          {
            event_type: 'fp_cross_user',
            evidence: crossUserEvidence,
            created_time: 1_700_000_000,
          },
        ],
      },
    ])

    const summary = await screen.findByRole('button', {
      name: /Distinct concurrent client fingerprints: 4/,
    })

    expect(summary).toHaveTextContent('Cross-user fingerprint')
    expect(summary).toHaveTextContent('alice, bob, #305')
  })

  test('shows raw evidence text instead of hiding unparsable evidence', async () => {
    const brokenEvidence =
      '{"fingerprint":"abcdef0123456789","user_ids":["7" "12"]}'
    renderTokenRiskTab([
      {
        ...summaryBase,
        latest_evidence: brokenEvidence,
        signals: [
          {
            event_type: 'fp_cross_user',
            evidence: brokenEvidence,
            created_time: 1_700_000_000,
          },
        ],
      },
    ])

    const summary = await screen.findByRole('button', { name: /user_ids/ })
    expect(summary).toHaveTextContent(brokenEvidence)

    fireEvent.click(summary)

    expect(
      within(await screen.findByRole('dialog')).getByText(brokenEvidence)
    ).toBeInTheDocument()
  })
})
