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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelStatus } from '@/features/model-status'

import type { ModelStatusModel } from '../types'

// PublicLayout renders the site header, which needs router context and site
// settings requests; this suite only covers the table interactions.
vi.mock('@/components/layout', () => ({
  PublicLayout: (props: { children: React.ReactNode }) => (
    <div>{props.children}</div>
  ),
}))

const SUCCESS_RATE_HEADER = 'Success rate'
const REQUEST_COUNT_HEADER = 'Requests'

// Seeded in an order that matches neither the default sort nor the reverse,
// so each assertion proves the client-side sorting actually reordered rows.
const models: ModelStatusModel[] = [
  {
    model_name: 'charlie',
    success_rate: 85,
    request_count: 120,
    avg_latency_ms: 1800,
    avg_tps: 22,
  },
  {
    model_name: 'bravo',
    success_rate: 62.5,
    request_count: 60,
    avg_latency_ms: 2600,
    avg_tps: 9,
  },
  {
    model_name: 'alpha',
    success_rate: 99.5,
    request_count: 40,
    avg_latency_ms: 900,
    avg_tps: 41,
  },
  {
    model_name: 'delta',
    success_rate: 72,
    request_count: 250,
    avg_latency_ms: 2100,
    avg_tps: 15,
  },
]

const successRateDescending = ['alpha', 'charlie', 'delta', 'bravo']
const successRateAscending = ['bravo', 'delta', 'charlie', 'alpha']
const requestCountDescending = ['delta', 'charlie', 'bravo', 'alpha']
const requestCountAscending = ['alpha', 'bravo', 'charlie', 'delta']

let client: QueryClient

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(['model-status', 168, ''], {
    success: true,
    data: {
      summary: {
        success_rate: 79.5,
        request_count: 470,
        avg_latency_ms: 1850,
        model_count: models.length,
      },
      window_start: 1789387200,
      window_end: 1789387200 + 168 * 3600,
      models,
    },
  })
  client.setQueryData(['model-status-groups'], {
    success: true,
    data: { default: {} },
  })
})

afterEach(() => client.clear())

function renderPage() {
  return render(
    <QueryClientProvider client={client}>
      <ModelStatus />
    </QueryClientProvider>
  )
}

function renderedModelOrder() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelector('td')?.textContent ?? '')
}

describe('model status table sorting', () => {
  it('lists models from the highest success rate to the lowest by default', () => {
    renderPage()

    expect(renderedModelOrder()).toEqual(successRateDescending)
    expect(
      screen.getByRole('columnheader', { name: SUCCESS_RATE_HEADER })
    ).toHaveAttribute('aria-sort', 'descending')
  })

  it('reverses to ascending when the success rate header is clicked', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: SUCCESS_RATE_HEADER }))

    expect(renderedModelOrder()).toEqual(successRateAscending)
    expect(
      screen.getByRole('columnheader', { name: SUCCESS_RATE_HEADER })
    ).toHaveAttribute('aria-sort', 'ascending')
  })

  it('returns to descending on a second click of the success rate header', async () => {
    const user = userEvent.setup()
    renderPage()
    const header = screen.getByRole('button', { name: SUCCESS_RATE_HEADER })

    await user.click(header)
    await user.click(header)

    expect(renderedModelOrder()).toEqual(successRateDescending)
    expect(
      screen.getByRole('columnheader', { name: SUCCESS_RATE_HEADER })
    ).toHaveAttribute('aria-sort', 'descending')
  })

  it('toggles the sort when the success rate header is activated from the keyboard', async () => {
    const user = userEvent.setup()
    renderPage()

    screen.getByRole('button', { name: SUCCESS_RATE_HEADER }).focus()
    await user.keyboard('{Enter}')

    expect(renderedModelOrder()).toEqual(successRateAscending)
  })

  it('sorts by request count when the requests header is clicked', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: REQUEST_COUNT_HEADER }))

    expect(renderedModelOrder()).toEqual(requestCountDescending)
    expect(
      screen.getByRole('columnheader', { name: REQUEST_COUNT_HEADER })
    ).toHaveAttribute('aria-sort', 'descending')
    expect(
      screen.getByRole('columnheader', { name: SUCCESS_RATE_HEADER })
    ).not.toHaveAttribute('aria-sort')
  })

  it('reverses the request count order on a second click', async () => {
    const user = userEvent.setup()
    renderPage()
    const header = screen.getByRole('button', { name: REQUEST_COUNT_HEADER })

    await user.click(header)
    await user.click(header)

    expect(renderedModelOrder()).toEqual(requestCountAscending)
    expect(
      screen.getByRole('columnheader', { name: REQUEST_COUNT_HEADER })
    ).toHaveAttribute('aria-sort', 'ascending')
  })

  it('keeps the dropdown and the header clicks on the same sort state', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.selectOptions(screen.getByLabelText('Sort by'), 'request_count')
    await user.click(screen.getByRole('button', { name: REQUEST_COUNT_HEADER }))

    expect(renderedModelOrder()).toEqual(requestCountAscending)
    expect(screen.getByLabelText('Sort by')).toHaveValue('request_count')
  })

  it('sorts by the field chosen in the dropdown and drops the success rate sort state', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.selectOptions(screen.getByLabelText('Sort by'), 'request_count')

    expect(renderedModelOrder()).toEqual(requestCountDescending)
    expect(
      screen.getByRole('columnheader', { name: SUCCESS_RATE_HEADER })
    ).not.toHaveAttribute('aria-sort')
  })

  it('labels the output speed column with its unit', () => {
    renderPage()

    expect(
      screen.getByRole('columnheader', { name: 'Output speed (tokens/s)' })
    ).toBeVisible()
  })
})
