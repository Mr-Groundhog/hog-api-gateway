/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the License.
*/

import { TicketStarIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
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
import { formatQuota } from '@/lib/format'

import type { LotteryDrawResult } from '../types'

type ResultDialogProps = {
  result: LotteryDrawResult | null
  onClose: () => void
}

export function ResultDialog(props: ResultDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={props.result !== null}
      onOpenChange={(open) => !open && props.onClose()}
    >
      <DialogContent className='lottery-result-dialog'>
        <DialogHeader>
          <span className='lottery-result-seal' aria-hidden='true'>
            <HugeiconsIcon icon={TicketStarIcon} />
          </span>
          <span className='lottery-kicker'>{t('The result is sealed')}</span>
          <DialogTitle>{t('Congratulations!')}</DialogTitle>
          <DialogDescription>
            {t('Your mystery grid has revealed')}
          </DialogDescription>
        </DialogHeader>
        <div className='lottery-result-prize'>
          <span aria-hidden='true'>{props.result?.prizeIcon}</span>
          <div>
            <strong>{props.result?.prizeName}</strong>
            <small>
              {props.result && props.result.quotaAmount > 0
                ? t('Awarded quota: {{amount}}', {
                    amount: formatQuota(props.result.quotaAmount),
                  })
                : props.result?.prizeLabel}
            </small>
          </div>
        </div>
        <DialogFooter>
          <Button type='button' onClick={props.onClose} className='w-full'>
            {t('Keep this luck')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
