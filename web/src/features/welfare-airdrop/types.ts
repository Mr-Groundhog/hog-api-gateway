/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

export type WelfareAirdropState =
  | 'upcoming'
  | 'active'
  | 'sold_out'
  | 'ended'
  | 'claimed'

export type WelfareAirdrop = {
  id: number
  name: string
  description: string
  quota: number
  totalCount: number
  claimedCount: number
  remaining: number
  unlimited: boolean
  perUserLimit: number
  claimedByMe: number
  canClaim: boolean
  state: WelfareAirdropState
  startTime: number
  endTime: number
  batchId: string
}

export type WelfareAirdropClaim = {
  id: number
  airdropId: number
  airdropName: string
  quota: number
  redemptionKey: string
  createdTime: number
}

export type WelfareAirdropApiResponse<T> = {
  success: boolean
  data?: T
  code?: string
  message?: string
}
