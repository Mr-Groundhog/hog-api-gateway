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
import { api } from '@/lib/api'

import type {
  CreateProxyParams,
  GetProxyListParams,
  ProxyBatchDeleteResult,
  ProxyBatchStatusResult,
  ProxyImportResult,
  ProxyListResponse,
  ProxyMutationResponse,
  ProxySimpleResponse,
  ProxySummaryResponse,
  ProxyTestResponse,
  TestProxiesParams,
  UpdateProxyParams,
} from './types'

export async function getProxyList(
  params: GetProxyListParams = {}
): Promise<ProxyListResponse> {
  const res = await api.get('/api/proxy', { params })
  return res.data
}

export async function getProxySummary(): Promise<ProxySummaryResponse> {
  const res = await api.get('/api/proxy/summary')
  return res.data
}

export async function createProxy(
  params: CreateProxyParams
): Promise<ProxyMutationResponse> {
  const res = await api.post('/api/proxy', params)
  return res.data
}

export async function updateProxy(
  params: UpdateProxyParams
): Promise<ProxyMutationResponse> {
  const res = await api.put(`/api/proxy/${params.id}`, {
    url: params.url,
    enabled: params.enabled,
  })
  return res.data
}

export async function deleteProxy(id: number): Promise<ProxySimpleResponse> {
  const res = await api.delete(`/api/proxy/${id}`)
  return res.data
}

export async function deleteProxyBatch(
  ids: number[]
): Promise<ProxySimpleResponse & { data?: ProxyBatchDeleteResult }> {
  const res = await api.post('/api/proxy/batch', { ids })
  return res.data
}

export async function setProxyStatusBatch(
  ids: number[],
  enabled: boolean
): Promise<ProxySimpleResponse & { data?: ProxyBatchStatusResult }> {
  const res = await api.post('/api/proxy/status/batch', { ids, enabled })
  return res.data
}

export async function importProxies(
  content: string,
  enabled = true
): Promise<ProxySimpleResponse & { data?: ProxyImportResult }> {
  const res = await api.post('/api/proxy/import', { content, enabled })
  return res.data
}

export async function testProxies(
  params: TestProxiesParams
): Promise<ProxyTestResponse> {
  const res = await api.post('/api/proxy/test', params)
  return res.data
}

export async function deleteInvalidProxies(
  includeNeverChecked = false
): Promise<ProxySimpleResponse & { data?: ProxyBatchDeleteResult }> {
  const res = await api.post('/api/proxy/delete_invalid', {
    include_never_checked: includeNeverChecked,
  })
  return res.data
}
