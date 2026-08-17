/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the License.
*/

import { describe, expect, it } from 'vitest'

import { getLotteryErrorKey } from '../lib'

describe('lottery error messages', () => {
  it('maps the daily limit API code to the next-day guidance', () => {
    const error = {
      response: { data: { code: 'LOTTERY_DAILY_LIMIT_REACHED' } },
    }

    expect(getLotteryErrorKey(error)).toBe(
      'You have already drawn today. Come back tomorrow.'
    )
  })

  it('uses a stable fallback for unknown network errors', () => {
    expect(getLotteryErrorKey(new Error('network unavailable'))).toBe(
      'The draw service is temporarily unavailable. Please try again later.'
    )
  })
})
