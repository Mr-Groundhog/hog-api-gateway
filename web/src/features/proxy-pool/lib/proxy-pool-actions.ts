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
import type { QueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { toast } from 'sonner'

import { handleServerError } from '@/lib/handle-server-error'

import {
  deleteInvalidProxies,
  deleteProxyBatch,
  setProxyStatusBatch,
  testProxies,
} from '../api'
import type { ProxyTestResult } from '../types'

export const proxyPoolQueryKeys = {
  all: ['proxy-pool'] as const,
  lists: () => [...proxyPoolQueryKeys.all, 'list'] as const,
  list: (params: Record<string, unknown>) =>
    [...proxyPoolQueryKeys.lists(), params] as const,
  summary: () => [...proxyPoolQueryKeys.all, 'summary'] as const,
}

/** 单次检测接口的条目上限，与后端保持一致。 */
export const PROXY_TEST_BATCH_SIZE = 20

function invalidateProxyPool(queryClient?: QueryClient) {
  queryClient?.invalidateQueries({ queryKey: proxyPoolQueryKeys.lists() })
  queryClient?.invalidateQueries({ queryKey: proxyPoolQueryKeys.summary() })
}

/**
 * 检测选中条目：按批次串行调用，避免一次请求长时间挂起。
 * 返回所有批次的检测结果。
 */
export async function handleTestProxies(
  ids: number[],
  queryClient?: QueryClient,
  onProgress?: (tested: number, total: number) => void
): Promise<ProxyTestResult[]> {
  if (ids.length === 0) {
    toast.error(i18next.t('No proxies selected'))
    return []
  }

  const results: ProxyTestResult[] = []
  try {
    for (let start = 0; start < ids.length; start += PROXY_TEST_BATCH_SIZE) {
      const batch = ids.slice(start, start + PROXY_TEST_BATCH_SIZE)
      const response = await testProxies({ ids: batch })
      if (!response.success) {
        handleServerError(response, i18next.t('Proxy test failed'))
        return results
      }
      results.push(...(response.data?.results ?? []))
      onProgress?.(results.length, ids.length)
    }
    const failed = results.filter((result) => !result.ok).length
    if (failed === 0) {
      toast.success(
        i18next.t('{{count}} proxy(ies) tested, all reachable', {
          count: results.length,
        })
      )
    } else {
      toast.warning(
        i18next.t('{{count}} proxy(ies) tested, {{failed}} unreachable', {
          count: results.length,
          failed,
        })
      )
    }
    invalidateProxyPool(queryClient)
  } catch (error) {
    handleServerError(error, i18next.t('Proxy test failed'))
  }
  return results
}

/**
 * 批量启用/禁用代理。
 */
export async function handleBatchProxyStatus(
  ids: number[],
  enabled: boolean,
  queryClient?: QueryClient,
  onSuccess?: () => void
): Promise<void> {
  if (ids.length === 0) {
    toast.error(i18next.t('No proxies selected'))
    return
  }
  try {
    const response = await setProxyStatusBatch(ids, enabled)
    if (!response.success) {
      handleServerError(response, i18next.t('Operation failed'))
      return
    }
    toast.success(
      enabled
        ? i18next.t('{{count}} proxy(ies) enabled', {
            count: response.data?.updated ?? ids.length,
          })
        : i18next.t('{{count}} proxy(ies) disabled', {
            count: response.data?.updated ?? ids.length,
          })
    )
    invalidateProxyPool(queryClient)
    onSuccess?.()
  } catch (error) {
    handleServerError(error, i18next.t('Operation failed'))
  }
}

/**
 * 批量删除代理。
 */
export async function handleBatchProxyDelete(
  ids: number[],
  queryClient?: QueryClient,
  onSuccess?: () => void
): Promise<void> {
  if (ids.length === 0) {
    toast.error(i18next.t('No proxies selected'))
    return
  }
  try {
    const response = await deleteProxyBatch(ids)
    if (!response.success) {
      handleServerError(response, i18next.t('Delete failed'))
      return
    }
    toast.success(
      i18next.t('{{count}} proxy(ies) deleted', {
        count: response.data?.deleted ?? ids.length,
      })
    )
    invalidateProxyPool(queryClient)
    onSuccess?.()
  } catch (error) {
    handleServerError(error, i18next.t('Delete failed'))
  }
}

/**
 * 一键删除无效代理：默认只删除最近一次检测失败的条目。
 */
export async function handleDeleteInvalidProxies(
  includeNeverChecked: boolean,
  queryClient?: QueryClient,
  onSuccess?: (deleted: number) => void
): Promise<void> {
  try {
    const response = await deleteInvalidProxies(includeNeverChecked)
    if (!response.success) {
      handleServerError(response, i18next.t('Delete failed'))
      return
    }
    const deleted = response.data?.deleted ?? 0
    if (deleted === 0) {
      toast.info(i18next.t('No invalid proxy to delete'))
    } else {
      toast.success(
        i18next.t('{{count}} invalid proxy(ies) deleted', { count: deleted })
      )
    }
    invalidateProxyPool(queryClient)
    onSuccess?.(deleted)
  } catch (error) {
    handleServerError(error, i18next.t('Delete failed'))
  }
}
