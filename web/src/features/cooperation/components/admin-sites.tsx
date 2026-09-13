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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePage, useDataTable } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { formatTimestampToDate } from '@/lib/format'

import {
  cooperationQueryKeys,
  deleteCooperationSite,
  getAdminCooperationSites,
} from '../api'
import type { CooperationSiteEntry } from '../types'
import { SiteFormDialog } from './site-form-dialog'

/**
 * 管理端「合作站点」Tab：展示条目的增删改 + 排序 / 重点 / 启停管理。
 * 数据量小（数十条以内），一次性加载后客户端分页。
 */
export function CooperationSitesTable() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editingSite, setEditingSite] = useState<CooperationSiteEntry | null>(
    null
  )
  const [deletingSite, setDeletingSite] = useState<CooperationSiteEntry | null>(
    null
  )

  const sitesQuery = useQuery({
    queryKey: cooperationQueryKeys.adminSites,
    queryFn: getAdminCooperationSites,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: cooperationQueryKeys.adminSites,
    })
  }

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteCooperationSite(id),
    onSuccess: () => {
      toast.success(t('Site deleted'))
      setDeletingSite(null)
      invalidate()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t('Operation failed')
      )
    },
  })

  const sites = sitesQuery.data ?? []

  const columns: ColumnDef<CooperationSiteEntry>[] = [
    {
      accessorKey: 'sort',
      header: t('Sort Order'),
      cell: ({ row }) => (
        <span className='text-muted-foreground font-mono text-sm'>
          {row.getValue('sort')}
        </span>
      ),
      size: 90,
    },
    {
      accessorKey: 'name',
      header: t('Site'),
      cell: ({ row }) => (
        <div className='min-w-0'>
          <a
            href={row.original.url}
            target='_blank'
            rel='noopener noreferrer'
            className='text-primary truncate text-sm font-medium hover:underline'
            title={row.original.url}
          >
            {row.getValue('name')}
          </a>
          <p className='text-muted-foreground truncate text-xs'>
            {row.original.url}
          </p>
        </div>
      ),
      size: 220,
    },
    {
      accessorKey: 'featured',
      header: t('Placement'),
      cell: ({ row }) =>
        row.original.featured ? (
          <StatusBadge
            label={t('Featured')}
            variant='warning'
            copyable={false}
            className='-ml-1.5'
          />
        ) : (
          <StatusBadge
            label={t('Standard')}
            variant='neutral'
            copyable={false}
            className='-ml-1.5'
          />
        ),
      size: 110,
    },
    {
      accessorKey: 'enabled',
      header: t('Status'),
      cell: ({ row }) =>
        row.original.enabled ? (
          <StatusBadge
            label={t('Enabled')}
            variant='success'
            copyable={false}
            className='-ml-1.5'
          />
        ) : (
          <StatusBadge
            label={t('Disabled')}
            variant='neutral'
            copyable={false}
            className='-ml-1.5'
          />
        ),
      size: 100,
    },
    {
      accessorKey: 'description',
      header: t('Site Description'),
      cell: ({ row }) => (
        <span
          className='text-muted-foreground block max-w-[240px] truncate text-sm'
          title={row.original.description}
        >
          {row.original.description || '-'}
        </span>
      ),
      size: 220,
    },
    {
      accessorKey: 'updated_time',
      header: t('Updated at'),
      cell: ({ row }) => (
        <span className='text-muted-foreground text-xs whitespace-nowrap'>
          {formatTimestampToDate(row.getValue('updated_time') as number)}
        </span>
      ),
      size: 150,
    },
    {
      id: 'actions',
      header: () => t('Actions'),
      size: 120,
      cell: ({ row }) => {
        const site = row.original
        return (
          <div className='flex items-center gap-1'>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label={t('Edit')}
              onClick={() => {
                setEditingSite(site)
                setFormOpen(true)
              }}
            >
              <Pencil aria-hidden='true' />
            </Button>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label={t('Delete')}
              className='text-destructive hover:text-destructive'
              onClick={() => setDeletingSite(site)}
            >
              <Trash2 aria-hidden='true' />
            </Button>
          </div>
        )
      },
      meta: { pinned: 'right' as const },
    },
  ]

  const { table } = useDataTable({
    data: sites,
    columns,
    enableRowSelection: false,
    enableSorting: false,
    initialPagination: { pageIndex: 0, pageSize: 20 },
  })

  return (
    <div className='flex h-full min-h-0 flex-col gap-4'>
      <div className='flex items-center justify-between gap-2'>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Manage the sites showcased on the public partner sites page. Featured sites are displayed first.'
          )}
        </p>
        <Button
          size='sm'
          className='shrink-0'
          onClick={() => {
            setEditingSite(null)
            setFormOpen(true)
          }}
        >
          <Plus aria-hidden='true' />
          {t('Add Site')}
        </Button>
      </div>
      <div className='min-h-0 flex-1'>
        <DataTablePage
          table={table}
          columns={columns}
          isLoading={sitesQuery.isLoading}
          isFetching={sitesQuery.isFetching}
          emptyTitle={t('No sites yet')}
          emptyDescription={t(
            'Add cooperating sites to showcase them on the partner sites page.'
          )}
          skeletonKeyPrefix='cooperation-sites-skeleton'
        />
      </div>

      <SiteFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        site={editingSite}
      />

      <ConfirmDialog
        open={deletingSite !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingSite(null)
        }}
        title={t('Delete site')}
        desc={t(
          'This will permanently delete the site {{name}}. This action cannot be undone.',
          { name: deletingSite?.name ?? '' }
        )}
        destructive
        confirmText={t('Delete')}
        isLoading={deleteMutation.isPending}
        handleConfirm={() => {
          if (deletingSite) deleteMutation.mutate(deletingSite.id)
        }}
      />
    </div>
  )
}
