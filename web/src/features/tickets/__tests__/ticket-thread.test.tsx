/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { TicketComposer } from '../components/ticket-composer'
import { TicketThread } from '../components/ticket-thread'
import { TICKET_AUTHOR_ROLE } from '../types'
import type { TicketMessage } from '../types'

const userMessage: TicketMessage = {
  id: 1,
  authorRole: TICKET_AUTHOR_ROLE.USER,
  username: 'alice',
  content: '调用 gpt-4o 时持续返回 429\n请求 ID：req_01H',
  createdTime: 1000,
}

const adminMessage: TicketMessage = {
  id: 2,
  authorRole: TICKET_AUTHOR_ROLE.ADMIN,
  username: 'bob',
  content: '已为你调整分组限速，请重试。',
  createdTime: 2000,
}

describe('ticket thread rendering', () => {
  test('preserves newlines in message content', () => {
    render(<TicketThread messages={[userMessage]} />)
    const paragraph = screen.getByText(/调用 gpt-4o 时持续返回 429/)
    expect(paragraph).toHaveClass('whitespace-pre-wrap')
    expect(paragraph.textContent).toContain('\n')
    expect(paragraph.textContent).toContain('请求 ID：req_01H')
  })

  test('renders injected markup as literal text, never as script nodes', () => {
    const injected: TicketMessage = {
      ...userMessage,
      id: 3,
      content: '<script>alert(1)</script>',
    }
    render(<TicketThread messages={[injected]} />)

    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
  })

  test('exposes the sender role as accessible text for both sides', () => {
    render(<TicketThread messages={[userMessage, adminMessage]} />)
    expect(screen.getByText('User')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })
})

describe('ticket composer disabled state', () => {
  test('disables the input and submit button with the reason text', () => {
    render(
      <TicketComposer
        label='Add a note…'
        submitLabel='Submit Reply'
        disabled
        disabledReason='This ticket is closed and no longer accepts replies.'
        onSubmit={vi.fn()}
      />
    )

    expect(
      screen.getByText('This ticket is closed and no longer accepts replies.')
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Add a note…')).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Submit Reply' })
    ).toBeDisabled()
  })

  test('submits normalized content and clears the input', () => {
    const onSubmit = vi.fn()
    render(
      <TicketComposer
        label='Add a note…'
        submitLabel='Submit Reply'
        onSubmit={onSubmit}
      />
    )

    const textarea = screen.getByLabelText('Add a note…')
    fireEvent.change(textarea, { target: { value: 'still failing\r\nafter fix' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit Reply' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('still failing\nafter fix')
    expect(textarea).toHaveValue('')
  })

  test('does not submit whitespace-only content', () => {
    const onSubmit = vi.fn()
    render(
      <TicketComposer
        label='Add a note…'
        submitLabel='Submit Reply'
        onSubmit={onSubmit}
      />
    )

    fireEvent.change(screen.getByLabelText('Add a note…'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit Reply' }))

    expect(onSubmit).not.toHaveBeenCalled()
  })
})
