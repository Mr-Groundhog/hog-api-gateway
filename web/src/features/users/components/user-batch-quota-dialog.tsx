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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import { formatQuota, parseQuotaFromDollars } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'

import { batchAdjustQuota } from '../api'
import type {
  BatchQuotaDirection,
  BatchQuotaMode,
  BatchQuotaResponse,
} from '../types'

const MAX_RATIO = 10

interface UserBatchQuotaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ids: number[]
  onSuccess: (result: BatchQuotaResponse) => void
}

export function UserBatchQuotaDialog(props: UserBatchQuotaDialogProps) {
  const { t } = useTranslation()
  const [direction, setDirection] = useState<BatchQuotaDirection>('add')
  const [mode, setMode] = useState<BatchQuotaMode>('ratio')
  const [ratio, setRatio] = useState('0.5')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)

  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()
  const tokensOnly = currencyMeta.kind === 'tokens'

  const ratioValue = Number.parseFloat(ratio)
  const ratioValid =
    Number.isFinite(ratioValue) && ratioValue > 0 && ratioValue <= MAX_RATIO
  const amountValue = Number.parseFloat(amount) || 0
  const quotaValue = parseQuotaFromDollars(Math.abs(amountValue))
  const fixedValid = quotaValue > 0
  const canConfirm = mode === 'ratio' ? ratioValid : fixedValid

  const previewText = () => {
    const verb = direction === 'add' ? t('Add') : t('Subtract')
    if (mode === 'ratio') {
      return t('{{verb}} each user by their current quota times {{ratio}}', {
        verb,
        ratio: ratioValid ? ratioValue : '?',
      })
    }
    return t('{{verb}} {{amount}} for each selected user', {
      verb,
      amount: tokensOnly
        ? formatQuota(quotaValue)
        : `${formatQuota(quotaValue)} ${currencyLabel}`.trim(),
    })
  }

  const handleConfirm = async () => {
    if (!canConfirm || props.ids.length === 0) return
    setLoading(true)
    try {
      const result = await batchAdjustQuota({
        ids: props.ids,
        direction,
        mode,
        ratio: mode === 'ratio' ? ratioValue : undefined,
        value: mode === 'fixed' ? quotaValue : undefined,
      })
      if (result.success && result.data) {
        props.onOpenChange(false)
        props.onSuccess(result.data)
      } else {
        handleServerError(result, t('Failed to adjust quota'))
      }
    } catch (error) {
      handleServerError(error, t('Failed to adjust quota'))
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    props.onOpenChange(false)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Adjust quota for selected users')}
      description={t('{{count}} user(s) selected', { count: props.ids.length })}
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button variant='outline' onClick={handleCancel} disabled={loading}>
            {t('Cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || !canConfirm || props.ids.length === 0}
          >
            {loading ? t('Processing...') : t('Confirm')}
          </Button>
        </>
      }
    >
      <div className='space-y-4'>
        <div className='text-muted-foreground text-sm'>{previewText()}</div>

        <div className='space-y-2'>
          <Label>{t('Direction')}</Label>
          <div className='flex gap-1'>
            {(['add', 'subtract'] as const).map((value) => (
              <Button
                key={value}
                type='button'
                variant='outline'
                size='sm'
                className={cn(
                  direction === value &&
                    'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                )}
                onClick={() => setDirection(value)}
              >
                {value === 'add' ? t('Add') : t('Subtract')}
              </Button>
            ))}
          </div>
        </div>

        <div className='space-y-2'>
          <Label>{t('Adjustment source')}</Label>
          <div className='flex gap-1'>
            {(['ratio', 'fixed'] as const).map((value) => (
              <Button
                key={value}
                type='button'
                variant='outline'
                size='sm'
                className={cn(
                  mode === value &&
                    'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                )}
                onClick={() => setMode(value)}
              >
                {value === 'ratio' ? t('Ratio') : t('Fixed amount')}
              </Button>
            ))}
          </div>
        </div>

        {mode === 'ratio' ? (
          <div className='space-y-2'>
            <Label>{t('Ratio')}</Label>
            <Input
              type='number'
              step={0.1}
              min={0}
              max={MAX_RATIO}
              placeholder='0.5'
              value={ratio}
              onChange={(event) => setRatio(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              {t(
                'Each user is adjusted by their own current quota times this ratio (max {{max}}).',
                { max: MAX_RATIO }
              )}
            </p>
          </div>
        ) : (
          <div className='space-y-2'>
            <Label>
              {t('Amount')} ({currencyLabel})
            </Label>
            <Input
              type='number'
              step={tokensOnly ? 1 : 0.000001}
              min={0}
              placeholder={
                tokensOnly
                  ? t('Enter amount in tokens')
                  : t('Enter amount in {{currency}}', { currency: currencyLabel })
              }
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
        )}

        <p className='text-muted-foreground text-xs'>
          {t(
            'Quota is adjusted per user and cannot be rolled back automatically. Submitting twice applies the change twice.'
          )}
        </p>
      </div>
    </Dialog>
  )
}
