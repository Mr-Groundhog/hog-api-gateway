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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Upload } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  ADMIN_PERMISSION_ACTIONS,
  ADMIN_PERMISSION_RESOURCES,
  hasPermission,
} from '@/lib/admin-permissions'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { deleteProxy, getProxyList, getProxySummary } from './api'
import { ProxyImportDialog } from './components/proxy-import-dialog'
import { ProxyMutateDialog } from './components/proxy-mutate-dialog'
import { ProxyPoolTable } from './components/proxy-pool-table'
import {
  handleDeleteInvalidProxies,
  handleTestProxies,
  proxyPoolQueryKeys,
} from './lib/proxy-pool-actions'
import type { ProxyEntry } from './types'

/** “检测全部”的单次枚举上限，避免代理池异常时拉取过量数据。 */
const PROXY_TEST_ALL_LIMIT = 2000

export function ProxyPool() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.auth.user)
  const canWrite = hasPermission(
    currentUser,
    ADMIN_PERMISSION_RESOURCES.PROXY,
    ADMIN_PERMISSION_ACTIONS.WRITE
  )
  const canOperate = hasPermission(
    currentUser,
    ADMIN_PERMISSION_RESOURCES.PROXY,
    ADMIN_PERMISSION_ACTIONS.OPERATE
  )

  const [mutateOpen, setMutateOpen] = useState(false)
  const [editingProxy, setEditingProxy] = useState<ProxyEntry | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [deletingProxy, setDeletingProxy] = useState<ProxyEntry | null>(null)
  const [deleteInvalidOpen, setDeleteInvalidOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isTestingAll, setIsTestingAll] = useState(false)

  const summaryQuery = useQuery({
    queryKey: proxyPoolQueryKeys.summary(),
    queryFn: async () => requireServerSuccess(await getProxySummary()),
  })
  const summary = summaryQuery.data?.data

  const handleTestAll = async () => {
    setIsTestingAll(true)
    try {
      const ids: number[] = []
      let page = 1
      while (ids.length < PROXY_TEST_ALL_LIMIT) {
        const response = requireServerSuccess(
          await getProxyList({ p: page, page_size: 100 })
        )
        const items = response.data?.items ?? []
        if (items.length === 0) {
          break
        }
        ids.push(...items.map((item) => item.id))
        if (items.length < 100 || ids.length >= (response.data?.total ?? 0)) {
          break
        }
        page += 1
      }
      if (ids.length === 0) {
        toast.info(t('No proxies to test'))
        return
      }
      await handleTestProxies(ids.slice(0, PROXY_TEST_ALL_LIMIT), queryClient)
    } catch (error) {
      handleServerError(error, t('Proxy test failed'))
    } finally {
      setIsTestingAll(false)
    }
  }

  const handleEditProxy = useCallback((proxy: ProxyEntry) => {
    setEditingProxy(proxy)
    setMutateOpen(true)
  }, [])

  const handleDeleteRequest = useCallback((proxy: ProxyEntry) => {
    setDeletingProxy(proxy)
  }, [])

  const handleTestProxy = useCallback(
    (proxy: ProxyEntry) => {
      void handleTestProxies([proxy.id], queryClient)
    },
    [queryClient]
  )

  const handleDelete = async () => {
    if (!deletingProxy) return
    setIsDeleting(true)
    try {
      const response = await deleteProxy(deletingProxy.id)
      if (!response.success) {
        handleServerError(response, t('Delete failed'))
        return
      }
      toast.success(t('Proxy deleted'))
      queryClient.invalidateQueries({ queryKey: proxyPoolQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: proxyPoolQueryKeys.summary() })
      setDeletingProxy(null)
    } catch (error) {
      handleServerError(error, t('Delete failed'))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('Proxy Pool')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='text-muted-foreground hidden text-xs sm:inline'>
              {t('Available proxies: {{enabled}} / {{total}}', {
                enabled: summary?.enabled ?? 0,
                total: summary?.total ?? 0,
              })}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={!canOperate || isTestingAll}
              onClick={() => void handleTestAll()}
            >
              {t('Test All')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={!canWrite}
              onClick={() => setDeleteInvalidOpen(true)}
            >
              <Trash2 aria-hidden='true' />
              {t('Delete Invalid')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={!canWrite}
              onClick={() => setImportOpen(true)}
            >
              <Upload aria-hidden='true' />
              {t('Import')}
            </Button>
            <Button
              size='sm'
              disabled={!canWrite}
              onClick={() => {
                setEditingProxy(null)
                setMutateOpen(true)
              }}
            >
              <Plus aria-hidden='true' />
              {t('Add Proxy')}
            </Button>
          </div>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <ProxyPoolTable
            canWrite={canWrite}
            canOperate={canOperate}
            onEdit={handleEditProxy}
            onDelete={handleDeleteRequest}
            onTest={handleTestProxy}
          />
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <ProxyMutateDialog
        open={mutateOpen}
        onOpenChange={setMutateOpen}
        proxy={editingProxy}
      />
      <ProxyImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <Dialog
        open={deletingProxy !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingProxy(null)
        }}
        title={t('Delete Proxy?')}
        description={t(
          'Deleting {{url}} cannot be undone. Channels using the proxy pool stop using it immediately.',
          { url: deletingProxy?.url ?? '' }
        )}
        contentHeight='auto'
        footer={
          <>
            <Button
              variant='outline'
              onClick={() => setDeletingProxy(null)}
              disabled={isDeleting}
            >
              {t('Cancel')}
            </Button>
            <Button
              variant='destructive'
              disabled={isDeleting}
              onClick={() => void handleDelete()}
            >
              {t('Delete')}
            </Button>
          </>
        }
      >
        {' '}
      </Dialog>
      <Dialog
        open={deleteInvalidOpen}
        onOpenChange={setDeleteInvalidOpen}
        title={t('Delete Invalid Proxies?')}
        description={t(
          'Proxies whose last check failed are deleted. Entries that were never checked are kept.'
        )}
        contentHeight='auto'
        footer={
          <>
            <Button
              variant='outline'
              onClick={() => setDeleteInvalidOpen(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              variant='destructive'
              onClick={() => {
                void handleDeleteInvalidProxies(false, queryClient, () =>
                  setDeleteInvalidOpen(false)
                )
              }}
            >
              {t('Delete')}
            </Button>
          </>
        }
      >
        {' '}
      </Dialog>
    </>
  )
}
