/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the License.
*/

import { api } from '@/lib/api'

export type LotteryPrizeTone = 'red' | 'gold' | 'cream' | 'muted'

export type AdminLotteryPrize = {
  id: number
  code: string
  name: string
  label: string
  icon: string
  tone: LotteryPrizeTone
  weight: number
  quota_amount: number
  sort_order: number
  active: boolean
}

export type LotteryApiResponse<T> = {
  success: boolean
  message?: string
  data?: T
}

export async function getLotteryPrizes(): Promise<AdminLotteryPrize[]> {
  const response = await api.get<LotteryApiResponse<AdminLotteryPrize[]>>(
    '/api/lottery/prizes'
  )
  if (!response.data.success || !Array.isArray(response.data.data)) {
    throw new Error(response.data.message || 'LOTTERY_PRIZES_FAILED')
  }
  return response.data.data
}

export async function createLotteryPrize(
  prize: Omit<AdminLotteryPrize, 'id'>
): Promise<AdminLotteryPrize> {
  const response = await api.post<LotteryApiResponse<AdminLotteryPrize>>(
    '/api/lottery/prizes',
    prize
  )
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.message || 'LOTTERY_PRIZE_CREATE_FAILED')
  }
  return response.data.data
}

export async function updateLotteryPrize(
  prize: AdminLotteryPrize
): Promise<AdminLotteryPrize> {
  const response = await api.put<LotteryApiResponse<AdminLotteryPrize>>(
    '/api/lottery/prizes',
    prize
  )
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.message || 'LOTTERY_PRIZE_UPDATE_FAILED')
  }
  return response.data.data
}

export async function deleteLotteryPrize(id: number): Promise<void> {
  const response = await api.delete<LotteryApiResponse<null>>(
    `/api/lottery/prizes/${id}`
  )
  if (!response.data.success) {
    throw new Error(response.data.message || 'LOTTERY_PRIZE_DELETE_FAILED')
  }
}
