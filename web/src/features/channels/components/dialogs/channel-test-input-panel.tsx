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
import { ChevronDown, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

import { getChannelTestInputs } from '../../lib'

type ChannelTestInputPanelProps = {
  endpointType: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChannelTestInputPanel(props: ChannelTestInputPanelProps) {
  const { t } = useTranslation()
  const testInputs = getChannelTestInputs(props.endpointType)

  return (
    <Collapsible
      open={props.open}
      onOpenChange={props.onOpenChange}
      className='rounded-lg border'
    >
      <CollapsibleTrigger
        render={
          <button
            type='button'
            className='hover:bg-muted/40 flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors'
            aria-expanded={props.open}
          />
        }
      >
        <div className='flex min-w-0 items-center gap-2'>
          <Info
            className='text-muted-foreground size-4 shrink-0'
            aria-hidden='true'
          />
          <span className='truncate text-sm font-medium'>{t('Test input')}</span>
          <span className='text-muted-foreground text-xs'>
            ({testInputs.length})
          </span>
        </div>
        <ChevronDown
          className={`text-muted-foreground size-4 shrink-0 transition-transform ${props.open ? 'rotate-180' : ''}`}
          aria-hidden='true'
        />
      </CollapsibleTrigger>
      <CollapsibleContent className='border-t px-3 py-3'>
        <p className='text-muted-foreground mb-2 text-xs'>
          {t('The following test input will be sent to the channel.')}
        </p>
        <div className='space-y-1.5'>
          {testInputs.map((input) => (
            <div
              key={`${input.category}-${input.label}-${input.value}`}
              className='grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start'
            >
              <span className='text-sm font-medium'>
                {t(input.category)} / {t(input.label)}
              </span>
              <code className='rounded bg-muted px-1.5 py-1 text-xs break-words whitespace-pre-wrap'>
                {input.value}
              </code>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
