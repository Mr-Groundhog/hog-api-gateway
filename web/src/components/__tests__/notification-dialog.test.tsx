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
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest'

import { useNotifications } from '@/hooks/use-notifications'
import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useNotificationStore } from '@/stores/notification-store'

import { NotificationDialog } from '../notification-dialog'

const status = {
  announcements_enabled: true,
  announcements: [
    {
      id: 1,
      content: '**New model available**',
      extra: 'Supports image input',
      publishDate: '2026-10-20T08:00:00Z',
      type: 'success',
    },
  ],
}
const clients: QueryClient[] = []
const getAnimationsDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'getAnimations'
)

beforeAll(() => {
  // jsdom lacks the animation API used by Base UI scroll areas.
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
})

afterAll(() => {
  if (getAnimationsDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      'getAnimations',
      getAnimationsDescriptor
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
  }
})

function NotificationCenter() {
  const notifications = useNotifications()
  return (
    <NotificationDialog
      open={notifications.dialogOpen}
      onOpenChange={notifications.setDialogOpen}
      unreadCount={notifications.unreadCount}
      activeTab={notifications.activeTab}
      onTabChange={notifications.setActiveTab}
      notice={notifications.notice}
      announcements={notifications.announcements}
      loading={notifications.loading}
    />
  )
}

function renderCenter() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  clients.push(client)
  const view = render(
    <QueryClientProvider client={client}>
      <NotificationCenter />
    </QueryClientProvider>
  )
  return { ...view, client }
}

beforeEach(() => {
  localStorage.clear()
  useNotificationStore.setState({
    lastReadNotice: '',
    readAnnouncementKeys: [],
    closedUntilDate: null,
  })
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url === '/api/status' ? status : 'Scheduled maintenance',
    },
  }))
})

afterEach(() => {
  for (const client of clients) client.clear()
  clients.length = 0
  vi.restoreAllMocks()
  localStorage.clear()
  useNotificationStore.setState({
    lastReadNotice: '',
    readAnnouncementKeys: [],
    closedUntilDate: null,
  })
})

test('daily display defaults to the timeline and switching to notice reads only that visible content', async () => {
  renderCenter()
  const dialog = await screen.findByRole('dialog', {
    name: 'System Announcements',
  })
  expect(within(dialog).getByRole('tab', { name: 'Timeline' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(within(dialog).getByText('New model available')).toBeVisible()
  expect(within(dialog).getByText('Supports image input')).toBeVisible()
  expect(
    within(dialog).queryByText('Scheduled maintenance')
  ).not.toBeInTheDocument()
  expect(useNotificationStore.getState().lastReadNotice).toBe('')
  await waitFor(() =>
    expect(useNotificationStore.getState().readAnnouncementKeys).toEqual([
      'id:1',
    ])
  )

  await userEvent.click(within(dialog).getByRole('tab', { name: 'Notice' }))
  expect(within(dialog).getByText('Scheduled maintenance')).toBeVisible()
  expect(useNotificationStore.getState().lastReadNotice).toBe(
    'Scheduled maintenance'
  )
})

test('dismissal survives remount and storage hydration while the message button still opens the same dialog', async () => {
  const first = renderCenter()
  await screen.findByRole('dialog')
  await userEvent.click(
    screen.getByRole('button', { name: 'Dismiss for Today' })
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  first.unmount()

  const persisted = localStorage.getItem('notification-storage')
  useNotificationStore.setState({ closedUntilDate: null })
  expect(persisted).not.toBeNull()
  localStorage.setItem('notification-storage', persisted ?? '')
  await useNotificationStore.persist.rehydrate()
  renderCenter()
  const button = await screen.findByRole('button', { name: 'Notifications' })
  await waitFor(() => expect(button).toHaveTextContent('1'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  await userEvent.click(button)
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByRole('tab', { name: 'Timeline' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(within(dialog).getByText('New model available')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(button).toHaveFocus()
})

test('acknowledging the daily dialog also prevents automatic display again that day', async () => {
  const first = renderCenter()
  await screen.findByRole('dialog')
  await userEvent.click(screen.getByRole('button', { name: 'I Acknowledge' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  first.unmount()
  renderCenter()
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Notifications' })
    ).toHaveTextContent('1')
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('a previous day dismissal allows the next daily timeline display', async () => {
  useNotificationStore.getState().setClosedUntilDate('Sat Oct 24 2026')
  vi.spyOn(Date.prototype, 'toDateString').mockReturnValue('Sun Oct 25 2026')
  renderCenter()
  await screen.findByRole('dialog')
  expect(useNotificationStore.getState().closedUntilDate).toBe(
    'Sun Oct 25 2026'
  )
})

test('empty content does not consume the daily display and later timeline content opens automatically', async () => {
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/status'
          ? { announcements_enabled: true, announcements: [] }
          : '',
    },
  }))
  const { client } = renderCenter()
  await waitFor(() => expect(client.isFetching()).toBe(0))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(useNotificationStore.getState().closedUntilDate).toBeNull()

  act(() => {
    client.setQueryData(STATUS_QUERY_KEY, status)
  })
  expect(await screen.findByRole('dialog')).toHaveTextContent(
    'New model available'
  )
})

test('disabled timeline content stays hidden and a notice remains available in the daily dialog', async () => {
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/status'
          ? { ...status, announcements_enabled: false }
          : 'Scheduled maintenance',
    },
  }))
  renderCenter()
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('No system announcements')).toBeVisible()
  expect(
    within(dialog).queryByText('New model available')
  ).not.toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('tab', { name: 'Notice' }))
  expect(within(dialog).getByText('Scheduled maintenance')).toBeVisible()
})

test('daily display waits for notification loading to finish', async () => {
  let resolveNotice!: (value: {
    data: { success: boolean; data: string }
  }) => void
  const pendingNotice = new Promise<{
    data: { success: boolean; data: string }
  }>((resolve) => {
    resolveNotice = resolve
  })
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/api/notice') return pendingNotice
    return { data: { success: true, data: status } }
  })
  const { client } = renderCenter()
  await waitFor(() =>
    expect(client.getQueryData(STATUS_QUERY_KEY)).toEqual(status)
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(useNotificationStore.getState().closedUntilDate).toBeNull()
  await act(async () => {
    resolveNotice({ data: { success: true, data: 'Loaded notice' } })
  })
  expect(await screen.findByRole('dialog')).toHaveTextContent(
    'New model available'
  )
})

test('unavailable persistent storage still allows opening and dismissing notifications in this session', async () => {
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('Storage disabled')
  })
  renderCenter()
  await screen.findByRole('dialog')
  await userEvent.click(
    screen.getByRole('button', { name: 'Dismiss for Today' })
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  await userEvent.click(screen.getByRole('button', { name: 'Notifications' }))
  expect(await screen.findByRole('dialog')).toHaveTextContent(
    'New model available'
  )
})
