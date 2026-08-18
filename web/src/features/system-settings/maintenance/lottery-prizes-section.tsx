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
*/

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { formatQuota, parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { SettingsSection } from '../components/settings-section'
import {
  getLotteryPrizes,
  updateLotteryPrize,
  type AdminLotteryPrize,
} from '../lottery-prizes'

export function LotteryPrizesSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const prizesQuery = useQuery({
    queryKey: ['lottery-prizes'],
    queryFn: getLotteryPrizes,
  })

  const [editing, setEditing] = useState<AdminLotteryPrize | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [quotaUsdInput, setQuotaUsdInput] = useState('')

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['lottery-prizes'] })

  const saveMutation = useMutation({
    mutationFn: (prize: AdminLotteryPrize) => updateLotteryPrize(prize),
    onSuccess: async () => {
      toast.success(t('Prize saved successfully'))
      setIsDialogOpen(false)
      setEditing(null)
      await invalidate()
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Failed to save prize'))
    },
  })

  const openEdit = (prize: AdminLotteryPrize) => {
    setEditing({ ...prize })
    setQuotaUsdInput(String(quotaUnitsToDollars(prize.quota_amount)))
    setIsDialogOpen(true)
  }

  const handleSave = () => {
    if (!editing) return
    const usd = parseFloat(quotaUsdInput) || 0
    saveMutation.mutate({
      ...editing,
      quota_amount: parseQuotaFromDollars(usd),
    })
  }

  const setEditingField = <K extends keyof AdminLotteryPrize>(
    key: K,
    value: AdminLotteryPrize[K]
  ) => {
    setEditing((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  const canSave =
    !!editing &&
    editing.code.trim() !== '' &&
    editing.name.trim() !== '' &&
    editing.weight >= 0 &&
    (parseFloat(quotaUsdInput) || 0) >= 0 &&
    editing.sort_order > 0

  return (
    <SettingsSection title={t('Lottery prizes')}>
      <Alert>
        <AlertDescription>
          {t(
            'Configure the eight-cell lottery prizes. Weight controls the relative chance (a higher weight means more likely to be drawn). Each draw is purely random by weight, so every user always has a chance to hit any prize regardless of how often it was won before.'
          )}
        </AlertDescription>
      </Alert>

      <div className='rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Code')}</TableHead>
              <TableHead>{t('Name')}</TableHead>
              <TableHead>{t('Label')}</TableHead>
              <TableHead>{t('Weight')}</TableHead>
              <TableHead>{t('Quota amount (USD)')}</TableHead>
              <TableHead>{t('Order')}</TableHead>
              <TableHead>{t('Status')}</TableHead>
              <TableHead className='text-right'>{t('Actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(prizesQuery.data ?? []).map((prize) => (
              <TableRow key={prize.id}>
                <TableCell className='font-mono text-xs'>
                  {prize.code}
                </TableCell>
                <TableCell>{prize.name}</TableCell>
                <TableCell className='text-muted-foreground max-w-[180px] truncate'>
                  {prize.label}
                </TableCell>
                <TableCell>{prize.weight}</TableCell>
                <TableCell>{formatQuota(prize.quota_amount)}</TableCell>
                <TableCell>{prize.sort_order}</TableCell>
                <TableCell>
                  <Badge variant={prize.active ? 'default' : 'outline'}>
                    {prize.active ? t('Active') : t('Disabled')}
                  </Badge>
                </TableCell>
                <TableCell className='text-right'>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => openEdit(prize)}
                  >
                    {t('Edit')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Edit prize')}</DialogTitle>
            <DialogDescription>
              {t('Configure the prize details shown on the lottery board.')}
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className='grid grid-cols-2 gap-4'>
              <div className='col-span-1 grid gap-1.5'>
                <Label>{t('Code')}</Label>
                <Input
                  value={editing.code}
                  placeholder={t('Unique code, e.g. first')}
                  disabled
                />
              </div>
              <div className='col-span-1 grid gap-1.5'>
                <Label>{t('Name')}</Label>
                <Input
                  value={editing.name}
                  placeholder={t('Prize name, e.g. First prize')}
                  onChange={(e) => setEditingField('name', e.target.value)}
                />
              </div>
              <div className='col-span-2 grid gap-1.5'>
                <Label>{t('Label')}</Label>
                <Input
                  value={editing.label}
                  placeholder={t('Description, e.g. 500 credits')}
                  onChange={(e) => setEditingField('label', e.target.value)}
                />
              </div>
              <div className='col-span-1 grid gap-1.5'>
                <Label>{t('Weight')}</Label>
                <Input
                  type='number'
                  min={0}
                  value={editing.weight}
                  placeholder={t('Chance weight, higher = more likely')}
                  onChange={(e) =>
                    setEditingField('weight', Number(e.target.value))
                  }
                />
              </div>
              <div className='col-span-1 grid gap-1.5'>
                <Label>{t('Quota amount (USD)')}</Label>
                <Input
                  type='number'
                  min={0}
                  step='0.01'
                  value={quotaUsdInput}
                  placeholder={t('Amount in USD, e.g. 100')}
                  onChange={(e) => setQuotaUsdInput(e.target.value)}
                />
              </div>
              <div className='col-span-1 grid gap-1.5'>
                <Label>{t('Order')}</Label>
                <Input
                  type='number'
                  min={1}
                  value={editing.sort_order}
                  placeholder={t('Board position 1-8')}
                  onChange={(e) =>
                    setEditingField('sort_order', Number(e.target.value))
                  }
                />
              </div>
              <div className='col-span-1 flex items-end justify-between gap-4 pb-0.5'>
                <Label>{t('Active')}</Label>
                <Switch
                  checked={editing.active}
                  onCheckedChange={(checked) =>
                    setEditingField('active', checked)
                  }
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setIsDialogOpen(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!canSave || saveMutation.isPending}
            >
              {t('Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  )
}
