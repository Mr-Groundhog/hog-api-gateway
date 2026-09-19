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

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

import { IMAGE_KEY_SOURCES } from '../constants'
import type { ImageKeySource } from '../types'

interface ImageSourceSelectProps {
  value: ImageKeySource
  onChange: (value: ImageKeySource) => void
  disabled?: boolean
}

/**
 * Chooses which credential a generation draws with.
 *
 * A key of this site is the default and the only option that bills the account;
 * the user's own endpoint is the escape hatch for keys this site does not
 * serve, and it is called straight from the browser.
 */
export function ImageSourceSelect(props: ImageSourceSelectProps) {
  const { t } = useTranslation()

  const items: ImageKeySource[] = [
    IMAGE_KEY_SOURCES.SYSTEM,
    IMAGE_KEY_SOURCES.CUSTOM,
  ]

  return (
    <ToggleGroup
      className='w-full'
      variant='outline'
      value={[props.value]}
      onValueChange={(value) => {
        // Pressing the active item clears the group; a source must stay chosen.
        const next = value[0]
        if (next) {
          props.onChange(next as ImageKeySource)
        }
      }}
      disabled={props.disabled}
      aria-label={t('Key source')}
    >
      {items.map((item) => (
        <ToggleGroupItem key={item} value={item} className='flex-1'>
          {item === IMAGE_KEY_SOURCES.SYSTEM
            ? t('System key')
            : t('Custom key')}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
