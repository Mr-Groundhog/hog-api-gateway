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
import { useTranslation } from 'react-i18next'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatQuota } from '@/lib/format'

import type { ImageKeyOption } from '../hooks/use-image-key'

interface ImageKeySelectProps {
  keys: ImageKeyOption[]
  selectedKey: ImageKeyOption | null
  onSelect: (id: number) => void
  disabled?: boolean
}

/**
 * Picks which of the user's own API keys pays for the generation.
 *
 * The choice matters beyond billing: a key carries its own group, and the group
 * decides which models can be reached and at what price.
 */
export function ImageKeySelect(props: ImageKeySelectProps) {
  const { t } = useTranslation()

  const items = props.keys.map((key) => ({
    value: String(key.id),
    label: key.name,
  }))

  return (
    <Select
      items={items}
      value={props.selectedKey ? String(props.selectedKey.id) : ''}
      onValueChange={(value) => {
        if (value) {
          props.onSelect(Number(value))
        }
      }}
      disabled={props.disabled}
    >
      <SelectTrigger id='image-studio-key' className='w-full min-w-0'>
        <SelectValue placeholder={t('Select an API key')} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {props.keys.map((key) => (
            <SelectItem key={key.id} value={String(key.id)}>
              <span className='truncate'>{key.name}</span>
              <span className='text-muted-foreground ml-auto shrink-0 text-xs'>
                {key.group || t('Default')}
                {' · '}
                {key.unlimitedQuota
                  ? t('Unlimited')
                  : formatQuota(key.remainQuota)}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
