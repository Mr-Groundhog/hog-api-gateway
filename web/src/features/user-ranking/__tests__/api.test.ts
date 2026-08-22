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
import { describe, expect, test, vi } from 'vitest'

import { getUserRankings } from '../api'

const apiGet = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', () => ({
  api: { get: apiGet },
}))

describe('getUserRankings', () => {
  test('normalizes a null IP list so the ranking page remains renderable', async () => {
    apiGet.mockResolvedValue({
      data: {
        data: {
          total: 1,
          items: [
            {
              user_id: 4,
              username: 'dave',
              ip_count: 0,
              ips: null,
              ten_minute_ip_count: 0,
              api_calls: 1,
            },
          ],
        },
      },
    })

    const result = await getUserRankings('today')

    expect(apiGet).toHaveBeenCalledWith('/api/log/user-rankings', {
      params: { period: 'today' },
    })
    expect(result.items[0]?.ips).toEqual([])
  })

  test('normalizes missing numeric values to zero', async () => {
    apiGet.mockResolvedValue({
      data: {
        data: {
          total: 1,
          items: [
            {
              user_id: 5,
              username: 'eve',
              ip_count: null,
              ips: [],
              ten_minute_ip_count: undefined,
              api_calls: Number.NaN,
            },
          ],
        },
      },
    })

    const result = await getUserRankings('today')

    expect(result.items[0]).toMatchObject({
      ip_count: 0,
      ten_minute_ip_count: 0,
      api_calls: 0,
    })
  })
})
