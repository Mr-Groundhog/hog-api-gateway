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
import { afterEach, describe, expect, test } from 'vitest'

import type { UsageLog } from '../../data/schema'
import type { LogOtherData } from '../../types'
import { DetailsDialog } from '../dialogs/details-dialog'

const queryClients: QueryClient[] = []

function makeLog(adminInfo: LogOtherData['admin_info']): UsageLog {
  return {
    id: 1,
    user_id: 1,
    created_at: 1,
    type: 2,
    content: 'consume',
    username: 'user',
    token_name: 'token',
    model_name: 'gpt-test',
    quota: 1,
    prompt_tokens: 1,
    completion_tokens: 1,
    use_time: 1,
    is_stream: false,
    channel: 1,
    channel_name: 'channel',
    token_id: 1,
    group: 'default',
    ip: '',
    other: JSON.stringify({ admin_info: adminInfo }),
    request_id: 'req-1',
    upstream_request_id: '',
  }
}

function renderDetails(
  isAdmin: boolean,
  adminInfo: LogOtherData['admin_info']
): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const freshAt = Date.now() + 60_000
  queryClient.setQueryData(['status'], {}, { updatedAt: freshAt })
  queryClients.push(queryClient)

  render(
    <QueryClientProvider client={queryClient}>
      <DetailsDialog
        log={makeLog(adminInfo)}
        isAdmin={isAdmin}
        isRoot={false}
        open
        onOpenChange={() => undefined}
      />
    </QueryClientProvider>
  )
}

afterEach(() => {
  for (const queryClient of queryClients) {
    queryClient.clear()
  }
  queryClients.length = 0
})

describe('usage log outbound route', () => {
  test('shows the proxy pool route and exit IP to admins', () => {
    renderDetails(true, {
      outbound_via: 'proxy_pool',
      outbound_ip: '203.0.113.7',
    })

    expect(screen.getByText('Outbound')).toBeInTheDocument()
    expect(screen.getByText('Proxy Pool')).toBeInTheDocument()
    expect(screen.getByText('203.0.113.7')).toBeInTheDocument()
  })

  test('hides the outbound route from non-admin users', () => {
    renderDetails(false, {
      outbound_via: 'proxy_pool',
      outbound_ip: '203.0.113.7',
    })

    expect(screen.queryByText('Outbound')).toBeNull()
    expect(screen.queryByText('Proxy Pool')).toBeNull()
    expect(screen.queryByText('203.0.113.7')).toBeNull()
  })

  test('omits the outbound section when the request used a direct connection', () => {
    renderDetails(true, {
      outbound_via: 'direct',
      outbound_ip: '198.51.100.9',
    })

    expect(screen.queryByText('Outbound')).toBeNull()
    expect(screen.queryByText('Direct Connection')).toBeNull()
    expect(screen.queryByText('198.51.100.9')).toBeNull()
  })
})
