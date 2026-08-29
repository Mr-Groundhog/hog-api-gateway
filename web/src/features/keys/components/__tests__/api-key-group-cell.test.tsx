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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { ApiKeyGroupOption } from '../api-key-group-combobox'

const mocks = vi.hoisted(() => ({
  getApiKey: vi.fn(),
  updateApiKey: vi.fn(),
  triggerRefresh: vi.fn(),
}))

vi.mock('../../api', () => mocks)
vi.mock('../api-keys-provider', () => ({
  useApiKeys: () => ({ triggerRefresh: mocks.triggerRefresh }),
}))

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { TooltipProvider } = await import('@/components/ui/tooltip')
const { ApiKeyGroupCell } = await import('../api-key-group-cell')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        Auto: 'Auto',
        'Cross-group': 'Cross-group',
        Ratio: 'Ratio',
        'Switch group': 'Switch group',
        'Search...': 'Search...',
        'No group found.': 'No group found.',
        'Automatically selects the best available group with circuit breaker mechanism':
          'Automatically selects the best available group with circuit breaker mechanism',
      },
    },
  },
})

const baseApiKey = {
  id: 1,
  name: 'test-key',
  key: 'sk-mock',
  status: 1,
  remain_quota: 1000000,
  used_quota: 0,
  unlimited_quota: true,
  expired_time: -1,
  created_time: 0,
  accessed_time: 0,
  group: 'default',
  auto_groups: null,
  cross_group_retry: false,
  model_limits_enabled: false,
  model_limits: '',
  allow_ips: '',
}

const groupOptions: ApiKeyGroupOption[] = [
  {
    value: 'auto',
    label: 'auto',
    desc: 'Global automatic routing',
    ratio: '自动',
  },
  { value: 'default', label: 'default', desc: 'User group', ratio: 1 },
  { value: 'vip', label: 'vip', desc: 'Priority group', ratio: 3 },
]

function CellHarness(props: {
  group?: string
  ratio?: number | string
  groupOptions?: ApiKeyGroupOption[]
  shouldReduceMotion?: boolean
}) {
  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <ApiKeyGroupCell
          apiKey={{ ...baseApiKey, group: props.group ?? baseApiKey.group }}
          ratio={props.ratio}
          groupOptions={props.groupOptions ?? []}
          shouldReduceMotion={props.shouldReduceMotion ?? false}
        />
      </TooltipProvider>
    </I18nextProvider>
  )
}

function getSwitchTrigger(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Switch group' })
}

function getCommandItem(label: string): HTMLElement {
  const item = [
    ...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]'),
  ].find((candidate) => candidate.textContent?.includes(label))
  if (!item) {
    throw new Error(`Expected command item containing "${label}"`)
  }
  return item
}

describe('API key group table cell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('renders an unclipped ring and a localized Auto ratio when API data uses a nonlocalized string', () => {
    const { container } = render(
      <CellHarness
        group='auto'
        ratio='自动'
        shouldReduceMotion={false}
      />
    )

    const badgeCell = container.querySelector<HTMLElement>(
      '[data-api-key-group-cell="auto"]'
    )
    expect(badgeCell).toHaveClass('overflow-visible')
    expect(badgeCell).not.toHaveClass('overflow-hidden')

    const frames = container.querySelectorAll('[data-auto-group-frame]')
    const movingRings = container.querySelectorAll(
      '[data-auto-group-flow-border]'
    )
    expect(frames.length).toBe(1)
    expect(movingRings.length).toBe(1)
    for (const frame of frames) {
      expect(frame).toHaveClass(
        'relative',
        'overflow-visible',
        'rounded-4xl',
        'p-px'
      )
    }

    const ratio = container.querySelector<HTMLElement>(
      '[data-auto-group-effect="ratio"]'
    )
    expect(ratio).toHaveTextContent('Auto Ratio')
    expect(ratio).not.toHaveTextContent('x')
    expect(container).not.toHaveTextContent('自动')
    expect(container).toHaveTextContent('Cross-group')

    const crossGroupBadge = [
      ...container.querySelectorAll<HTMLElement>('[data-slot="status-badge"]'),
    ].find((badge) => badge.textContent === 'Cross-group')
    expect(crossGroupBadge).not.toBeUndefined()
    expect(crossGroupBadge?.closest('[data-auto-group-frame]')).toBeNull()
  })

  test('keeps the static Auto ratio frame but omits its moving layer for reduced motion', () => {
    const { container } = render(
      <CellHarness group='auto' ratio='Auto' shouldReduceMotion />
    )

    expect(container.querySelectorAll('[data-auto-group-frame]').length).toBe(1)
    expect(
      container.querySelectorAll('[data-auto-group-flow-border]').length
    ).toBe(0)
  })

  test('shows only the cross-group badge when ratio data is unavailable', () => {
    const { container } = render(<CellHarness group='auto' shouldReduceMotion={false} />)

    expect(container.querySelectorAll('[data-auto-group-frame]').length).toBe(0)
    expect(
      container.querySelectorAll('[data-auto-group-flow-border]').length
    ).toBe(0)
    expect(container.querySelector('[data-auto-group-effect="ratio"]')).toBe(
      null
    )
    expect(container).toHaveTextContent('Cross-group')
    expect(container).not.toHaveTextContent('Auto')
    expect(container).not.toHaveTextContent('Ratio')
  })

  test('narrows normal group ratios to numbers and never applies Auto rings', () => {
    const { container, rerender } = render(
      <CellHarness group='vip' ratio='自动' shouldReduceMotion={false} />
    )

    expect(container).toHaveTextContent('vip')
    expect(container).not.toHaveTextContent('自动')
    expect(container.querySelector('[data-auto-group-frame]')).toBe(null)
    expect(container.querySelector('[data-auto-group-flow-border]')).toBe(null)

    rerender(<CellHarness group='vip' ratio={3} shouldReduceMotion={false} />)

    expect(container).toHaveTextContent('3x')
    expect(container.querySelector('[data-auto-group-frame]')).toBe(null)
  })

  test('switches group by submitting fresh token data with only the group replaced', async () => {
    mocks.getApiKey.mockResolvedValue({
      success: true,
      data: { ...baseApiKey, remain_quota: 123456 },
    })
    mocks.updateApiKey.mockResolvedValue({ success: true })

    render(<CellHarness group='default' groupOptions={groupOptions} />)

    fireEvent.click(getSwitchTrigger())
    fireEvent.click(getCommandItem('Priority group'))

    await waitFor(() => {
      expect(mocks.updateApiKey).toHaveBeenCalledTimes(1)
    })
    expect(mocks.getApiKey).toHaveBeenCalledWith(1)
    expect(mocks.updateApiKey).toHaveBeenCalledWith({
      id: 1,
      name: 'test-key',
      remain_quota: 123456,
      expired_time: -1,
      unlimited_quota: true,
      model_limits_enabled: false,
      model_limits: '',
      allow_ips: '',
      group: 'vip',
      auto_groups: [],
      cross_group_retry: false,
    })
    expect(mocks.triggerRefresh).toHaveBeenCalledTimes(1)
  })

  test('enables cross-group retry with inherit Auto order when switching to Auto', async () => {
    mocks.getApiKey.mockResolvedValue({ success: true, data: baseApiKey })
    mocks.updateApiKey.mockResolvedValue({ success: true })

    render(<CellHarness group='default' groupOptions={groupOptions} />)

    fireEvent.click(getSwitchTrigger())
    fireEvent.click(getCommandItem('Global automatic routing'))

    await waitFor(() => {
      expect(mocks.updateApiKey).toHaveBeenCalledTimes(1)
    })
    expect(mocks.updateApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        group: 'auto',
        auto_groups: [],
        cross_group_retry: true,
      })
    )
    expect(mocks.triggerRefresh).toHaveBeenCalledTimes(1)
  })

  test('ignores selection of the current group without any request', () => {
    render(<CellHarness group='default' groupOptions={groupOptions} />)

    fireEvent.click(getSwitchTrigger())
    fireEvent.click(getCommandItem('User group'))

    expect(mocks.getApiKey).not.toHaveBeenCalled()
    expect(mocks.updateApiKey).not.toHaveBeenCalled()
    expect(mocks.triggerRefresh).not.toHaveBeenCalled()
  })
})
