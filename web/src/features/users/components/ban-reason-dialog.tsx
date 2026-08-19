import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import { USER_BAN_REASONS, USER_BAN_REASON_OPTIONS } from '../constants'

interface BanReasonDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  username: string
  onConfirm: (reason: string) => Promise<void>
}

export function BanReasonDialog({
  open,
  onOpenChange,
  username,
  onConfirm,
}: BanReasonDialogProps) {
  const { t } = useTranslation()
  const [reasonType, setReasonType] = useState<string>(
    USER_BAN_REASONS.BATCH_ACTIVITY_CHECK
  )
  const [customReason, setCustomReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const selectedReasonLabel =
    reasonType === USER_BAN_REASONS.CUSTOM
      ? t('Custom reason')
      : t(
          USER_BAN_REASON_OPTIONS.find((option) => option.value === reasonType)
            ?.labelKey ?? 'Select a ban reason'
        )

  useEffect(() => {
    if (!open) {
      setReasonType(USER_BAN_REASONS.BATCH_ACTIVITY_CHECK)
      setCustomReason('')
      setIsSubmitting(false)
    }
  }, [open])

  const handleConfirm = async () => {
    const reason =
      reasonType === USER_BAN_REASONS.CUSTOM
        ? customReason.trim()
        : reasonType
    if (!reason) return
    setIsSubmitting(true)
    try {
      await onConfirm(reason)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Disable user')}</DialogTitle>
          <DialogDescription>
            {t('Choose a ban reason for {{username}}.', { username })}
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <Select
            value={reasonType}
            onValueChange={(value) => value && setReasonType(value)}
          >
            <SelectTrigger className='w-full'>
              <SelectValue>{selectedReasonLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {USER_BAN_REASON_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
                <SelectItem value={USER_BAN_REASONS.CUSTOM}>
                  {t('Custom reason')}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {reasonType === USER_BAN_REASONS.CUSTOM && (
            <Textarea
              value={customReason}
              onChange={(event) => setCustomReason(event.target.value)}
              placeholder={t('Enter a custom ban reason')}
              maxLength={255}
              rows={4}
            />
          )}
        </div>
        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t('Cancel')}
          </Button>
          <Button
            variant='destructive'
            onClick={handleConfirm}
            disabled={
              isSubmitting ||
              (reasonType === USER_BAN_REASONS.CUSTOM && !customReason.trim())
            }
          >
            {isSubmitting ? t('Saving...') : t('Disable')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
