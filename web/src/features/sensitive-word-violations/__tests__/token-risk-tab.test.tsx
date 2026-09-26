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
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import zhCN from '@/i18n/locales/zh.json'

import type { TokenRiskUserSummary } from '../api-token-risk'
import { TokenRiskTab } from '../components/token-risk-tab'
import { EVENT_DESCRIPTIONS, EVENT_LABELS } from '../lib/evidence'

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
  source_ip: '203.0.113.7',
  accounts: [
    {
      user_id: 7,
      username: 'alice',
      token_id: 21,
      requests: 12,
      first_seen: 1_700_000_000,
      last_seen: 1_700_003_600,
    },
    {
      user_id: 12,
      username: 'bob',
      token_id: 22,
      requests: 4,
      first_seen: 1_700_000_100,
      last_seen: 1_700_000_200,
    },
    {
      user_id: 305,
      username: '#305',
      token_id: 23,
      requests: 3,
      first_seen: 1_700_000_300,
      last_seen: 1_700_000_400,
    },
  ],
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

const ipBurstEvidence = JSON.stringify({
  distinct_source_networks: 18,
  valid_source_networks: 15,
  threshold: 10,
  source_networks: [
    { network: '203.0.113.7', requests: 42 },
    { network: '2001:db8:1:2::/64', requests: 12 },
  ],
})

const summaryBase: TokenRiskUserSummary = {
  user_id: 7,
  username: 'alice',
  event_count: 4,
  concurrent_fp_count: 0,
  single_fp_count: 0,
  fp_burst_count: 0,
  ip_burst_count: 0,
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

const ipBurstSummary: TokenRiskUserSummary = {
  ...summaryBase,
  ip_burst_count: 1,
  fp_cross_user_count: 0,
  latest_event_type: 'ip_burst',
  latest_evidence: ipBurstEvidence,
  signals: [
    {
      event_type: 'ip_burst',
      evidence: ipBurstEvidence,
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

  // 语言切换用例结束后恢复基准语言，避免影响其它用例。
  afterEach(async () => {
    await act(() => i18next.changeLanguage('en'))
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

  test('lists the source IPs behind a source IP burst', async () => {
    renderTokenRiskTab([ipBurstSummary])

    const dialog = await openEvidenceDialog(
      /Distinct source IPs in one day: 18/
    )

    expect(dialog.getByText('203.0.113.7')).toBeInTheDocument()
    expect(dialog.getByText('2001:db8:1:2::/64')).toBeInTheDocument()
    expect(dialog.getAllByText('Requests in one day:')).toHaveLength(2)
    expect(dialog.getByText(EVENT_DESCRIPTIONS.ip_burst)).toBeInTheDocument()
  })

  test('explains the source IP burst signal in the interface language', async () => {
    i18next.addResourceBundle(
      'zhCN',
      'translation',
      zhCN.translation,
      true,
      true
    )
    renderTokenRiskTab([ipBurstSummary])

    await openEvidenceDialog(/Distinct source IPs in one day: 18/)
    await act(() => i18next.changeLanguage('zhCN'))

    expect(screen.getByText('来源 IP 发散 ×1')).toBeInTheDocument()
    expect(
      screen.getByText(/IPv6 按 \/64 前缀算作一个来源网络/)
    ).toBeInTheDocument()
  })

  test('names the accounts sharing the fingerprint for a cross-user event', async () => {
    renderTokenRiskTab([summaryBase])

    const dialog = await openEvidenceDialog(/Source IP: 203\.0\.113\.7/)

    expect(
      dialog.getByText('Accounts sharing this fingerprint')
    ).toBeInTheDocument()
    expect(dialog.getByText('alice')).toBeInTheDocument()
    expect(dialog.getByText('bob')).toBeInTheDocument()
    expect(dialog.getByText('#305')).toBeInTheDocument()
    expect(dialog.getByText('203.0.113.7')).toBeInTheDocument()
  })

  test('shows when each account was seen instead of raw timestamps', async () => {
    renderTokenRiskTab([summaryBase])

    const dialog = await openEvidenceDialog(/Source IP: 203\.0\.113\.7/)

    expect(dialog.getAllByText('First request time:')).toHaveLength(3)
    expect(dialog.getAllByText('Last request time:')).toHaveLength(3)
    expect(dialog.queryByText('1700000000')).not.toBeInTheDocument()
  })

  test('identifies the client behind the shared fingerprint', async () => {
    renderTokenRiskTab([summaryBase])

    const dialog = await openEvidenceDialog(/Source IP: 203\.0\.113\.7/)

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
    expect(summary).toHaveTextContent('Source IP: 203.0.113.7')
  })

  test('translates every distribution signal label and description', () => {
    const zh = zhCN.translation as Record<string, string>
    for (const key of [
      ...Object.values(EVENT_LABELS),
      ...Object.values(EVENT_DESCRIPTIONS),
    ]) {
      expect(zh[key], `${key} must be translated`).toBeTruthy()
      expect(zh[key], `${key} must not fall back to English`).not.toBe(key)
    }
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
