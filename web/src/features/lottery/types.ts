/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the License.
*/

export type LotteryPrizeTone = 'red' | 'gold' | 'cream' | 'muted'

export type LotteryPrize = {
  code: string
  name: string
  label: string
  icon: string
  tone: LotteryPrizeTone
  quotaAmount: number
  sortOrder: number
}

export type LotteryDrawResult = {
  prizeCode: string
  prizeName: string
  prizeLabel: string
  prizeIcon: string
  prizeTone: LotteryPrizeTone
  boardIndex: number
  quotaAmount: number
}

export type LotteryRecord = {
  id: number
  displayName: string
  prizeCode: string
  prizeName: string
  prizeLabel: string
  quotaAmount: number
  createdAt: string
}

export type LotteryApiResponse<T> = {
  success: boolean
  code?: string
  message?: string
  data?: T
}
