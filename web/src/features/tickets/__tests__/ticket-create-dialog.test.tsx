/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { TicketCreateDialog } from '../components/ticket-create-dialog'
import { TICKET_FORM_DEFAULT_VALUES } from '../lib/ticket-form'
import type { TicketDetail } from '../types'

const createTicketMock = vi.fn()

vi.mock('../api', () => ({
  ticketQueryKeys: {
    list: ['tickets', 'list'],
    unread: ['tickets', 'unread'],
    adminList: ['tickets', 'adminList'],
    adminStats: ['tickets', 'adminStats'],
    detail: (id: number) => ['tickets', 'detail', id],
  },
  createTicket: (...args: unknown[]) => createTicketMock(...args),
}))

const createdDetail: TicketDetail = {
  id: 7,
  userId: 1,
  username: '',
  type: 1,
  title: 'api 429',
  status: 1,
  messageCount: 1,
  unreadReply: false,
  lastReplyTime: 100,
  createdTime: 100,
  messages: [],
  canReply: true,
  canClose: true,
}

function renderDialog(onOpenChange = vi.fn()) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <TicketCreateDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>
  )
}

function fillTitle(value: string) {
  fireEvent.change(screen.getByLabelText('Ticket Title'), {
    target: { value },
  })
}

function fillContent(value: string) {
  fireEvent.change(screen.getByLabelText('Ticket Content'), {
    target: { value },
  })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
}

describe('ticket create dialog validation', () => {
  beforeEach(() => {
    createTicketMock.mockReset()
    createTicketMock.mockResolvedValue(createdDetail)
  })

  test('submits with the default type set to API Calls', async () => {
    const onOpenChange = vi.fn()
    renderDialog(onOpenChange)
    fillTitle('api 429')
    fillContent('getting 429 all the time')
    submit()

    await waitFor(() => expect(createTicketMock).toHaveBeenCalledTimes(1))
    expect(createTicketMock).toHaveBeenCalledWith({
      type: 1,
      title: 'api 429',
      content: 'getting 429 all the time',
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  test('blocks a 51-character title and shows the field error', async () => {
    renderDialog()
    fillTitle('标'.repeat(51))
    fillContent('hello')
    submit()

    await waitFor(() =>
      expect(screen.getByText(/Title must be between/)).toBeInTheDocument()
    )
    expect(createTicketMock).not.toHaveBeenCalled()
  })

  test('blocks content over 1000 characters', async () => {
    renderDialog()
    fillTitle('api 429')
    fillContent('容'.repeat(1001))
    submit()

    await waitFor(() =>
      expect(screen.getByText(/Content must be between/)).toBeInTheDocument()
    )
    expect(createTicketMock).not.toHaveBeenCalled()
  })

  test('normalizes CRLF to LF before submitting', async () => {
    renderDialog()
    fillTitle('api 429')
    fillContent('step 1\r\nstep 2')
    submit()

    await waitFor(() => expect(createTicketMock).toHaveBeenCalledTimes(1))
    expect(createTicketMock).toHaveBeenCalledWith({
      type: 1,
      title: 'api 429',
      content: 'step 1\nstep 2',
    })
  })

  test('form defaults keep an empty title and content', () => {
    expect(TICKET_FORM_DEFAULT_VALUES).toEqual({
      type: 1,
      title: '',
      content: '',
    })
  })
})
