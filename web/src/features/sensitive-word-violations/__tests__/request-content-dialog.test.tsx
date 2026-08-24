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

import type { SensitiveWordViolation } from '../api'
import { RequestContentDialog } from '../components/request-content-dialog'

const clipboardMock = vi.hoisted(() => ({ copyToClipboard: vi.fn() }))

vi.mock('@/lib/copy-to-clipboard', () => clipboardMock)

const violation: SensitiveWordViolation = {
  id: 1,
  user_id: 42,
  username: 'alice',
  ip: '192.0.2.1',
  user_agent: 'Vitest',
  request_path: '/v1/chat/completions',
  request_content: 'plain intro, SECRET here, more text, another secret tail',
  matched_words: '["secret"]',
  match_locations: '[]',
  trigger_count: 5,
  highlighted: true,
  created_at: 100,
}

let scrollTargets: Element[] = []

function highlights() {
  return Array.from(document.querySelectorAll('mark'))
}

function jumpButton() {
  return screen.getByRole('button', { name: 'Jump to match' })
}

describe('request content dialog match navigation', () => {
  beforeEach(() => {
    scrollTargets = []
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(
      function (this: HTMLElement) {
        scrollTargets.push(this)
      }
    )
  })

  test('highlights every matched word regardless of casing', () => {
    render(<RequestContentDialog violation={violation} onClose={() => {}} />)

    expect(highlights().map((mark) => mark.textContent)).toEqual([
      'SECRET',
      'secret',
    ])
  })

  test('lists the matched words above the content', () => {
    render(<RequestContentDialog violation={violation} onClose={() => {}} />)

    expect(screen.getByText('2 matches found')).toBeVisible()
    expect(
      screen.getByText('Matched Words').parentElement
    ).toHaveTextContent('secret')
  })

  test('jumping scrolls the first match into view and marks it as current', () => {
    render(<RequestContentDialog violation={violation} onClose={() => {}} />)

    fireEvent.click(jumpButton())

    expect(scrollTargets).toEqual([highlights()[0]])
    expect(highlights()[0]).toHaveAttribute('aria-current', 'true')
    expect(highlights()[1]).not.toHaveAttribute('aria-current')
    expect(screen.getByText('Match 1 of 2')).toBeVisible()
  })

  test('jumping again advances to the next match', () => {
    render(<RequestContentDialog violation={violation} onClose={() => {}} />)

    fireEvent.click(jumpButton())
    fireEvent.click(jumpButton())

    expect(scrollTargets[1]).toBe(highlights()[1])
    expect(highlights()[1]).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('Match 2 of 2')).toBeVisible()
  })

  test('jumping past the last match cycles back to the first one', () => {
    render(<RequestContentDialog violation={violation} onClose={() => {}} />)

    fireEvent.click(jumpButton())
    fireEvent.click(jumpButton())
    fireEvent.click(jumpButton())

    expect(scrollTargets[2]).toBe(highlights()[0])
    expect(screen.getByText('Match 1 of 2')).toBeVisible()
  })

  test('disables jumping when the stored word is absent from the content', () => {
    render(
      <RequestContentDialog
        violation={{
          ...violation,
          request_content: 'nothing to see here',
          matched_words: '["secret"]',
        }}
        onClose={() => {}}
      />
    )

    expect(highlights()).toHaveLength(0)
    expect(jumpButton()).toBeDisabled()
    expect(
      screen.getByText('No match found in the request content.')
    ).toBeVisible()
  })
})

describe('request content dialog request metadata and copying', () => {
  beforeEach(() => {
    clipboardMock.copyToClipboard.mockReset()
    clipboardMock.copyToClipboard.mockResolvedValue(true)
  })

  test('shows the user agent that issued the blocked request', () => {
    render(<RequestContentDialog violation={violation} onClose={() => {}} />)

    expect(screen.getByText('User Agent').parentElement).toHaveTextContent(
      'Vitest'
    )
  })

  test('falls back to a placeholder when the user agent was not recorded', () => {
    render(
      <RequestContentDialog
        violation={{ ...violation, user_agent: '' }}
        onClose={() => {}}
      />
    )

    expect(screen.getByText('User Agent').parentElement).toHaveTextContent('-')
  })

  test('copies the raw request content and acknowledges the copy', async () => {
    render(<RequestContentDialog violation={violation} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(clipboardMock.copyToClipboard).toHaveBeenCalledWith(
      violation.request_content
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible()
    )
  })

  test('keeps the copy button idle when the copy fails', async () => {
    clipboardMock.copyToClipboard.mockResolvedValue(false)
    render(<RequestContentDialog violation={violation} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() =>
      expect(clipboardMock.copyToClipboard).toHaveBeenCalledTimes(1)
    )
    expect(screen.getByRole('button', { name: 'Copy' })).toBeVisible()
  })

  test('disables copying when the record has no stored content', () => {
    render(
      <RequestContentDialog
        violation={{ ...violation, request_content: '' }}
        onClose={() => {}}
      />
    )

    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled()
  })
})
