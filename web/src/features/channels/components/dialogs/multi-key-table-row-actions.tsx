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
import { Ban, Loader2, Play, Trash2, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import type { MultiKeyConfirmAction } from '../../types'

type MultiKeyTableRowActionsProps = {
  keyIndex: number
  status: number
  canDelete: boolean
  testing?: boolean
  onTest: (keyIndex: number) => void
  onAction: (action: MultiKeyConfirmAction) => void
}

export function MultiKeyTableRowActions({
  keyIndex,
  status,
  canDelete,
  testing = false,
  onTest,
  onAction,
}: MultiKeyTableRowActionsProps) {
  const { t } = useTranslation()
  const isEnabled = status === 1

  return (
    <div className='flex justify-end gap-1'>
      <Button
        variant='outline'
        size='icon'
        onClick={() => onTest(keyIndex)}
        disabled={testing}
        title={t('Test')}
      >
        {testing ? (
          <Loader2 className='animate-spin' />
        ) : (
          <Zap />
        )}
      </Button>
      {isEnabled ? (
        <Button
          variant='outline'
          size='icon'
          onClick={() => onAction({ type: 'disable', keyIndex })}
          title={t('Disable')}
        >
          <Ban />
        </Button>
      ) : (
        <Button
          variant='outline'
          size='icon'
          onClick={() => onAction({ type: 'enable', keyIndex })}
          title={t('Enable')}
        >
          <Play />
        </Button>
      )}
      <Button
        variant='destructive'
        size='icon'
        onClick={() => {
          if (!canDelete) return
          onAction({ type: 'delete', keyIndex })
        }}
        disabled={!canDelete}
        title={
          canDelete ? t('Delete') : t('No permission to perform this action')
        }
      >
        <Trash2 />
      </Button>
    </div>
  )
}
