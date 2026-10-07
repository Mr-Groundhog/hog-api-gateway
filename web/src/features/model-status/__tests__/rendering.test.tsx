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
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelStatus } from '@/features/model-status'

import type { ModelStatusModel } from '../types'

// PublicLayout renders the site header, which needs router context and site
// settings requests; this suite only covers the rendered rows.
vi.mock('@/components/layout', () => ({
  PublicLayout: (props: { children: React.ReactNode }) => (
    <div>{props.children}</div>
  ),
}))

const NO_VALUE = '—'

function model(
  model_name: string,
  success_rate: number,
  request_count: number,
  avg_latency_ms: number,
  avg_tps: number
): ModelStatusModel {
  return { model_name, success_rate, request_count, avg_latency_ms, avg_tps }
}

const models = [
  model('no-traffic', 0, 0, 0, 0),
  model('single-call', 100, 1, 800, 12),
  model('at-threshold', 90, 500, 1200, 30),
  model('just-below', 89.99, 400, 1400, 25),
  model('at-unstable', 80, 300, 1900, 18),
  model('failing', 79.99, 200, 2400, 9),
]

let client: QueryClient

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(['model-status', 168, ''], {
    success: true,
    data: {
      summary: {
        success_rate: 88,
        request_count: 1401,
        avg_latency_ms: 1500,
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

function renderedRow(modelName: string) {
  const row = screen
    .getAllByRole('row')
    .slice(1)
    .find(
      (candidate) =>
        within(candidate).getAllByRole('cell')[0].textContent === modelName
    )
  if (!row) throw new Error(`row not rendered: ${modelName}`)
  const cells = within(row).getAllByRole('cell')
  return {
    status: cells[1].textContent,
    successRate: cells[2].textContent,
    avgResponse: cells[4].textContent,
    outputSpeed: cells[5].textContent,
  }
}

function mobileCard(modelName: string) {
  const list = document.querySelector("[data-slot='model-status-cards']")
  if (!list) throw new Error('mobile card list not rendered')
  const card = within(list as HTMLElement)
    .getByText(modelName)
    .closest("[data-slot='model-status-card']")
  if (!card) throw new Error(`mobile card not rendered: ${modelName}`)
  return card as HTMLElement
}

describe('model status row rendering', () => {
  it('shows no status and no values for a model with zero requests', () => {
    renderPage()

    expect(renderedRow('no-traffic')).toEqual({
      status: NO_VALUE,
      successRate: NO_VALUE,
      avgResponse: NO_VALUE,
      outputSpeed: NO_VALUE,
    })
  })

  it('treats a single successful request as a normal model', () => {
    renderPage()

    expect(renderedRow('single-call')).toMatchObject({
      status: 'Normal',
      successRate: '100.00%',
    })
  })

  it('keeps 90 percent normal and 89.99 percent unstable', () => {
    renderPage()

    expect(renderedRow('at-threshold').status).toBe('Normal')
    expect(renderedRow('just-below').status).toBe('Unstable')
  })

  it('keeps 80 percent unstable and 79.99 percent abnormal', () => {
    renderPage()

    expect(renderedRow('at-unstable').status).toBe('Unstable')
    expect(renderedRow('failing').status).toBe('Abnormal')
  })

  it('keeps the table inside a horizontally scrollable container where it is shown', () => {
    renderPage()

    expect(screen.getByRole('table').parentElement).toHaveClass(
      'overflow-x-auto'
    )
  })

  it('swaps the narrow-screen card list for the table on wider screens', () => {
    renderPage()

    expect(
      document.querySelector("[data-slot='model-status-cards']")
    ).toHaveClass('md:hidden')
    expect(screen.getByRole('table').parentElement).toHaveClass(
      'hidden',
      'md:block'
    )
  })

  it('shows the same metrics in the narrow-screen cards as in the table', () => {
    renderPage()

    expect(mobileCard('no-traffic')).toHaveTextContent(NO_VALUE)
    expect(mobileCard('single-call')).toHaveTextContent('Normal')
    expect(mobileCard('single-call')).toHaveTextContent('100.00%')
    expect(mobileCard('single-call')).toHaveTextContent(
      'Output speed (tokens/s)'
    )
    expect(mobileCard('failing')).toHaveTextContent('Abnormal')
  })

  it('keeps table headers on a single line so they cannot stack vertically', () => {
    renderPage()

    for (const header of screen.getAllByRole('columnheader')) {
      expect(header).toHaveClass('whitespace-nowrap')
    }
  })
})
