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

import {
  getSensitiveWordViolationUsers,
  getSensitiveWordViolations,
  resetSensitiveWordViolationCount,
} from '../api'

const apiGet = vi.hoisted(() => vi.fn())
const apiPost = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', () => ({
  api: { get: apiGet, post: apiPost },
}))

describe('getSensitiveWordViolations', () => {
  test('passes keyword and date filters to the violations endpoint', async () => {
    apiGet.mockResolvedValue({
      data: {
        data: { page: 1, page_size: 100, total: 0, items: [] },
      },
    })

    await getSensitiveWordViolations(1, 100, {
      keyword: 'secret',
      start_time: 100,
      end_time: 200,
    })

    expect(apiGet).toHaveBeenCalledWith('/api/sensitive-word-violations', {
      params: {
        p: 1,
        page_size: 100,
        keyword: 'secret',
        start_time: 100,
        end_time: 200,
      },
    })
  })

  test('normalizes empty violation results returned as null', async () => {
    apiGet.mockResolvedValue({
      data: {
        data: { page: 1, page_size: 20, total: 0, items: null },
      },
    })

    const result = await getSensitiveWordViolations(1, 20, {
      keyword: 'no-match',
    })

    expect(result.items).toEqual([])
  })

  test('normalizes empty user search results returned as null', async () => {
    apiGet.mockResolvedValue({
      data: {
        data: { page: 1, page_size: 20, total: 0, items: null },
      },
    })

    const result = await getSensitiveWordViolationUsers(1, 20, {
      user: 'no-match',
    })

    expect(result.items).toEqual([])
  })

  test('posts the user id to the count reset endpoint', async () => {
    apiPost.mockResolvedValue({ data: { success: true } })

    await resetSensitiveWordViolationCount(42)

    expect(apiPost).toHaveBeenCalledWith(
      '/api/sensitive-word-violations/reset-count',
      { user_id: 42 }
    )
  })
})
