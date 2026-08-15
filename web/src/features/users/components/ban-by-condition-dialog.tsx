/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General License as
published by the Free Software Foundation, either version 3 of
the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { banUserByCondition } from '../api'
import { ERROR_MESSAGES } from '../constants'
import type { BanByConditionMode } from '../types'
import { useUsers } from './users-provider'

const DAY_SECONDS = 86400
const PRESET_DAYS = [3, 7, 15, 30]

export function BanByConditionDialog() {
  const { t } = useTranslation()
  const { open, setOpen, triggerRefresh } = useUsers()

  const [mode, setMode] = useState<BanByConditionMode>('last_login')
  const [presetDays, setPresetDays] = useState<number>(30)
  const [customTime, setCustomTime] = useState<string>('')
  const [useCustom, setUseCustom] = useState<boolean>(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const computedBefore = (): number => {
    if (useCustom) {
      // datetime-local value is local time, e.g. 2026-08-01T12:00
      const ms = new Date(customTime).getTime()
      return Math.floor(ms / 1000)
    }
    return Math.floor(Date.now() / 1000) - presetDays * DAY_SECONDS
  }

  const canSubmit = (): boolean => {
    if (useCustom) return customTime.trim().length > 0
    return true
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setOpen(null)
      setUseCustom(false)
      setCustomTime('')
    }
  }

  const handleConfirm = async () => {
    if (!canSubmit()) return

    setIsSubmitting(true)
    try {
      const result = await banUserByCondition({
        mode,
        before: computedBefore(),
      })
      if (result.success) {
        const banned = (result.data?.banned ?? 0) as number
        if (banned > 0) {
          toast.success(t('{{count}} user(s) banned successfully', { count: banned }))
        } else {
          toast.info(t('No users matched the condition'))
        }
        setOpen(null)
        setUseCustom(false)
        setCustomTime('')
        triggerRefresh()
      } else {
        toast.error(result.message || t(ERROR_MESSAGES.UNEXPECTED))
      }
    } catch {
      toast.error(t(ERROR_MESSAGES.UNEXPECTED))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open === 'ban_by_condition'} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('Conditional Ban')}</DialogTitle>
          <DialogDescription>
            {t(
              'Banned users will be disabled immediately and their sessions and tokens will be invalidated.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4 py-2'>
          {/* 封禁依据 */}
          <div className='flex flex-col gap-1.5'>
            <label className='text-sm font-medium'>{t('Ban by')}</label>
            <Select
              items={[
                { value: 'last_login', label: t('Last login time') },
                { value: 'last_call', label: t('Last API call time') },
              ]}
              value={mode}
              onValueChange={(value) =>
                value !== null && setMode(value as BanByConditionMode)
              }
            >
              <SelectTrigger className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='last_login'>
                  {t('Last login time')}
                </SelectItem>
                <SelectItem value='last_call'>{t('Last API call time')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 时间条件 */}
          <div className='flex flex-col gap-1.5'>
            <label className='text-sm font-medium'>{t('Time before')}</label>
            <div className='flex flex-wrap gap-2'>
              {PRESET_DAYS.map((days) => (
                <Button
                  key={days}
                  type='button'
                  size='sm'
                  variant={
                    !useCustom && presetDays === days ? 'default' : 'outline'
                  }
                  onClick={() => {
                    setUseCustom(false)
                    setPresetDays(days)
                  }}
                >
                  {t('{{days}} days ago', { days })}
                </Button>
              ))}
            </div>
            <Button
              type='button'
              size='sm'
              variant={useCustom ? 'default' : 'outline'}
              className='w-fit'
              onClick={() => setUseCustom(true)}
            >
              {t('Custom time')}
            </Button>
            {useCustom && (
              <input
                type='datetime-local'
                className='border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:ring-3'
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            disabled={isSubmitting}
            onClick={() => handleOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='button'
            variant='destructive'
            disabled={isSubmitting || !canSubmit()}
            onClick={handleConfirm}
          >
            {isSubmitting ? t('Processing...') : t('Confirm ban')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
