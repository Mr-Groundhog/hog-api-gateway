import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import {
  USER_AI_REVIEW_BAN_REASON_PREFIX,
  USER_BAN_REASONS,
  USER_BAN_REASON_OPTIONS,
} from '../constants'

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
  const [reasonText, setReasonText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const requiresReason =
    reasonType === USER_BAN_REASONS.CUSTOM ||
    reasonType === USER_BAN_REASONS.AI_REVIEW
  const reasonPrefix =
    reasonType === USER_BAN_REASONS.AI_REVIEW
      ? USER_AI_REVIEW_BAN_REASON_PREFIX
      : ''

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
      setReasonText('')
      setIsSubmitting(false)
    }
  }, [open])

  const handleConfirm = async () => {
    if (requiresReason && !reasonText.trim()) return
    const reason = requiresReason
      ? reasonPrefix + reasonText.trim()
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
          {requiresReason && (
            <Textarea
              aria-label={t('Ban reason')}
              value={reasonText}
              onChange={(event) => setReasonText(event.target.value)}
              placeholder={
                reasonType === USER_BAN_REASONS.CUSTOM
                  ? t('Enter a custom ban reason')
                  : t('Ban reason')
              }
              maxLength={255 - reasonPrefix.length}
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
            disabled={isSubmitting || (requiresReason && !reasonText.trim())}
          >
            {isSubmitting ? t('Saving...') : t('Disable')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
