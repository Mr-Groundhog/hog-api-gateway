/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { api } from '@/lib/api'

import type {
  WelfareAirdrop,
  WelfareAirdropApiResponse,
  WelfareAirdropClaim,
} from './types'

export const welfareAirdropQueryKeys = {
  campaigns: ['welfare-airdrop', 'campaigns'] as const,
  claims: ['welfare-airdrop', 'claims'] as const,
  admin: ['welfare-airdrop', 'admin'] as const,
}

export type AdminWelfareAirdrop = {
  id: number
  name: string
  description: string
  quota: number
  total_count: number
  claimed_count: number
  per_user_limit: number
  start_time: number
  end_time: number
  status: number
  batch_id: string
}

function requireData<T>(response: WelfareAirdropApiResponse<T>, fallback: string) {
  if (!response.success || response.data === undefined) {
    throw new Error(response.code || fallback)
  }
  return response.data
}

export async function getWelfareAirdrops(): Promise<WelfareAirdrop[]> {
  const response = await api.get<WelfareAirdropApiResponse<WelfareAirdrop[]>>(
    '/api/welfare-airdrop/',
    { skipErrorHandler: true }
  )
  return requireData(response.data, 'WELFARE_AIRDROP_LOAD_FAILED')
}

export async function getWelfareAirdropClaims(): Promise<WelfareAirdropClaim[]> {
  const response = await api.get<
    WelfareAirdropApiResponse<WelfareAirdropClaim[]>
  >('/api/welfare-airdrop/my-claims', { skipErrorHandler: true })
  return requireData(response.data, 'WELFARE_AIRDROP_CLAIMS_LOAD_FAILED')
}

export async function getAllWelfareAirdrops(): Promise<AdminWelfareAirdrop[]> {
  const response = await api.get<
    WelfareAirdropApiResponse<AdminWelfareAirdrop[]>
  >('/api/welfare-airdrop/admin', { skipErrorHandler: true })
  return requireData(response.data, 'WELFARE_AIRDROP_LOAD_FAILED')
}

export async function updateWelfareAirdropStatus(
  id: number,
  status: number
): Promise<void> {
  const response = await api.put<WelfareAirdropApiResponse<null>>(
    '/api/welfare-airdrop/admin/status',
    { id, status },
    { skipErrorHandler: true }
  )
  requireData(response.data, 'WELFARE_AIRDROP_UPDATE_FAILED')
}

export async function deleteWelfareAirdrop(id: number): Promise<void> {
  const response = await api.delete<WelfareAirdropApiResponse<null>>(
    `/api/welfare-airdrop/admin/${id}`,
    { skipErrorHandler: true }
  )
  requireData(response.data, 'WELFARE_AIRDROP_DELETE_FAILED')
}

export async function claimWelfareAirdrop(
  airdropId: number
): Promise<WelfareAirdropClaim> {
  try {
    const response = await api.post<
      WelfareAirdropApiResponse<WelfareAirdropClaim>
    >(
      `/api/welfare-airdrop/claim/${airdropId}`,
      {},
      { skipErrorHandler: true }
    )
    return requireData(response.data, 'WELFARE_AIRDROP_CLAIM_FAILED')
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'response' in error) {
      const response = (error as { response?: { data?: WelfareAirdropApiResponse<unknown> } }).response
      const code = response?.data?.code
      if (code) throw new Error(code)
    }
    throw error
  }
}
