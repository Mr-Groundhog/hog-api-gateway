/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the License.
*/

import type { AxiosError } from 'axios'

export function getLotteryErrorKey(error: unknown): string {
  const axiosError = error as AxiosError<{ code?: string }>
  const code = axiosError.response?.data?.code
  if (code === 'LOTTERY_DAILY_LIMIT_REACHED') {
    return 'You have already drawn today. Come back tomorrow.'
  }
  if (code === 'LOTTERY_NOT_CONFIGURED') {
    return 'The prize pool is not available yet.'
  }
  return 'The draw service is temporarily unavailable. Please try again later.'
}

export function getLotteryStepDelay(progress: number): number {
  return 48 + Math.pow(progress, 3) * 240
}
