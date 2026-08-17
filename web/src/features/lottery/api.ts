/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the License.
*/

import { api } from '@/lib/api'

import type {
  LotteryApiResponse,
  LotteryDrawResult,
  LotteryPrize,
  LotteryRecord,
} from './types'

export async function drawLottery(): Promise<LotteryDrawResult> {
  const response = await api.post<LotteryApiResponse<LotteryDrawResult>>(
    '/api/lottery/draw',
    {},
    { skipErrorHandler: true }
  )
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.code || 'LOTTERY_DRAW_FAILED')
  }
  return response.data.data
}

export async function getTodayLotteryRecords(): Promise<LotteryRecord[]> {
  const response = await api.get<LotteryApiResponse<LotteryRecord[]>>(
    '/api/lottery/today-records',
    { skipErrorHandler: true }
  )
  if (!response.data.success || !Array.isArray(response.data.data)) {
    throw new Error(response.data.code || 'LOTTERY_RECORDS_FAILED')
  }
  return response.data.data
}

export async function getLotteryConfig(): Promise<LotteryPrize[]> {
  const response = await api.get<LotteryApiResponse<LotteryPrize[]>>(
    '/api/lottery/config',
    { skipErrorHandler: true }
  )
  if (!response.data.success || !Array.isArray(response.data.data)) {
    throw new Error(response.data.code || 'LOTTERY_CONFIG_FAILED')
  }
  return response.data.data
}

export interface LotteryUserDraw {
  prizeName: string
  prizeLabel: string
  quotaAmount: number
  createdAt: string
}

export interface LotteryStatus {
  remaining: number
  daily_limit: number
  my_draw: LotteryUserDraw | null
  rank: number | null
}

export async function getLotteryStatus(): Promise<LotteryStatus> {
  const response = await api.get<LotteryApiResponse<LotteryStatus>>(
    '/api/lottery/status',
    { skipErrorHandler: true }
  )
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.code || 'LOTTERY_STATUS_FAILED')
  }
  return response.data.data
}

export async function getMyLotteryRecords(): Promise<LotteryUserDraw[]> {
  const response = await api.get<LotteryApiResponse<LotteryUserDraw[]>>(
    '/api/lottery/my-records',
    { skipErrorHandler: true }
  )
  if (!response.data.success || !Array.isArray(response.data.data)) {
    throw new Error(response.data.code || 'LOTTERY_MY_RECORDS_FAILED')
  }
  return response.data.data
}
