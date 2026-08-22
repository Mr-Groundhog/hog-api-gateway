/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

For commercial licensing, please contact support@quantumnous.com
*/
import { LoaderCircle, Settings } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatQuota } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import {
  deleteWelfareAirdrop,
  getAllWelfareAirdrops,
  updateWelfareAirdropStatus,
  welfareAirdropQueryKeys,
  type AdminWelfareAirdrop,
} from './api'

function AdminCampaignRow({
  campaign,
  onToggle,
  onDelete,
  pending,
}: {
  campaign: AdminWelfareAirdrop
  onToggle: () => void
  onDelete: () => void
  pending: boolean
}) {
  const { t } = useTranslation()
  const enabled = campaign.status === 1
  return (
    <div className="flex flex-col gap-3 border-b py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-medium">
          <span className="truncate">{campaign.name}</span>
          <Badge
            className={
              enabled
                ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-500'
                : 'border-muted-foreground/30 bg-muted text-muted-foreground'
            }
          >
            {enabled ? t('Enabled') : t('Disabled')}
          </Badge>
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {t('Airdrop batch ID')}: {campaign.batch_id} ·{' '}
          {formatQuota(campaign.quota)} · {campaign.claimed_count} /{' '}
          {campaign.total_count === 0 ? t('Unlimited') : campaign.total_count}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={onToggle}
        >
          {enabled ? t('Disable') : t('Enable')}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive" size="sm">
              {t('Delete')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('Delete campaign')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(
                  'Deleting the campaign will not revoke credits that were already claimed.',
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>
                {t('Delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}

// AdminCampaigns 是兑换码页「空投活动」Tab 的内容：管理全部空投活动的启用状态
// 与删除，供管理员取消发错的空投。
export function AdminCampaigns() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const user = useAuthStore((state) => state.auth.user)
  const isAdmin = !!(user?.role && user.role >= 10)
  const query = useQuery({
    queryKey: welfareAirdropQueryKeys.admin,
    queryFn: getAllWelfareAirdrops,
    enabled: isAdmin,
    retry: false,
  })
  const invalidate = useCallback(() => {
    void client.invalidateQueries({ queryKey: ['welfare-airdrop'] })
  }, [client])
  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: number }) =>
      updateWelfareAirdropStatus(id, status),
    onSuccess: invalidate,
    onError: () => toast.error(t('Operation failed')),
  })
  const deleteMutation = useMutation({
    mutationFn: deleteWelfareAirdrop,
    onSuccess: invalidate,
    onError: () => toast.error(t('Operation failed')),
  })
  if (!isAdmin) return null
  const campaigns = query.data ?? []
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border">
      <h2 className="flex shrink-0 items-center gap-2 border-b px-5 py-4 font-semibold">
        <Settings className="size-4 text-cyan-500" aria-hidden="true" />
        {t('Campaign management')}
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-1">
        {query.isLoading ? (
          <div className="text-muted-foreground flex justify-center py-8">
            <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
          </div>
        ) : campaigns.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            {t('No campaigns yet')}
          </p>
        ) : (
          campaigns.map((campaign) => (
            <AdminCampaignRow
              key={campaign.id}
              campaign={campaign}
              pending={
                (toggleMutation.isPending &&
                  toggleMutation.variables?.id === campaign.id) ||
                (deleteMutation.isPending &&
                  deleteMutation.variables === campaign.id)
              }
              onToggle={() =>
                toggleMutation.mutate({
                  id: campaign.id,
                  status: campaign.status === 1 ? 2 : 1,
                })
              }
              onDelete={() => deleteMutation.mutate(campaign.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}
