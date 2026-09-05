import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { TicketThread } from '../components/ticket-thread'
import { TICKET_AUTHOR_ROLE, type TicketMessage } from '../types'

const userMessage: TicketMessage = {
  id: 1,
  authorRole: TICKET_AUTHOR_ROLE.USER,
  username: 'alice',
  content: 'first message',
  createdTime: 1000,
}

const adminMessage: TicketMessage = {
  id: 2,
  authorRole: TICKET_AUTHOR_ROLE.ADMIN,
  username: 'bob',
  content: 'latest message',
  createdTime: 2000,
}

describe('ticket thread scrolling', () => {
  test('scrolls to the latest message when messages change', () => {
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollHeight'
    )
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 420,
    })

    const { rerender } = render(<TicketThread messages={[userMessage]} />)
    rerender(<TicketThread messages={[userMessage, adminMessage]} />)

    const thread = screen
      .getByText('first message')
      .closest('[data-slot=ticket-thread-scroll]') as HTMLElement
    expect(thread.scrollTop).toBe(420)
    if (originalScrollHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollHeight',
        originalScrollHeight
      )
    } else {
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
    }
  })

  test('shows a back-to-top button after scrolling up and returns to the top', () => {
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollHeight'
    )
    const originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientHeight'
    )
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 420,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 200,
    })

    render(<TicketThread messages={[userMessage, adminMessage]} />)
    const thread = screen
      .getByText('first message')
      .closest('[data-slot=ticket-thread-scroll]') as HTMLElement

    expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull()

    thread.scrollTop = 100
    fireEvent.scroll(thread)
    fireEvent.click(screen.getByRole('button', { name: 'Back to top' }))

    expect(thread.scrollTop).toBe(0)
    expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull()

    if (originalScrollHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollHeight',
        originalScrollHeight
      )
    } else {
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
    }
    if (originalClientHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'clientHeight',
        originalClientHeight
      )
    } else {
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
    }
  })
})
