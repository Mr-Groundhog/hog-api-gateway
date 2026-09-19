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

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { QUALITY_LABEL_KEYS } from '../constants'
import { getDisplayOptions } from '../lib/model-capabilities'
import type { ImageStudioConfig } from '../types'

interface FieldSelectProps {
  id: string
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  disabled?: boolean
}

function FieldSelect(props: FieldSelectProps) {
  const { t } = useTranslation()

  return (
    <div className='space-y-2'>
      <Label htmlFor={props.id}>{props.label}</Label>
      <Select
        items={props.options}
        value={props.value}
        onValueChange={(value) => {
          if (value) {
            props.onChange(value)
          }
        }}
        disabled={props.disabled}
      >
        <SelectTrigger id={props.id} className='w-full min-w-0'>
          <SelectValue placeholder={t('Auto')} />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {props.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

interface ImageParameterFieldsProps {
  config: ImageStudioConfig
  onConfigChange: (patch: Partial<ImageStudioConfig>) => void
  disabled?: boolean
}

/**
 * The full set of adjustable dimensions, always on screen.
 *
 * Every control is rendered for every model, so the panel does not change shape
 * as the model changes. The model only decides the candidates inside each
 * dropdown: its own list where it has one, a general list otherwise. Whether a
 * chosen value actually reaches the provider is decided separately, in
 * `buildImageRequestBody`, so a control the model cannot express is inert
 * rather than a request the upstream would reject.
 *
 * A model that takes explicit dimensions over a wide range is sized by the pair
 * instead: the ratio and resolution are what the user chooses, and the pixels
 * they add up to are worked out when the request is built. Showing that size
 * would only invite the user to second-guess a number that is not theirs to
 * pick.
 */
export function ImageParameterFields(props: ImageParameterFieldsProps) {
  const { t } = useTranslation()
  const display = getDisplayOptions(props.config.model, props.config.ratio)

  const identify = (value: string) => ({ value, label: value })

  return (
    <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
      {display.derivesSize ? null : (
        <FieldSelect
          id='image-studio-size'
          label={t('Size')}
          value={props.config.size}
          options={display.sizes.map(identify)}
          onChange={(size) => props.onConfigChange({ size })}
          disabled={props.disabled}
        />
      )}

      <FieldSelect
        id='image-studio-ratio'
        label={t('Aspect ratio')}
        value={props.config.ratio}
        options={display.ratios.map(identify)}
        onChange={(ratio) => props.onConfigChange({ ratio })}
        disabled={props.disabled}
      />

      <FieldSelect
        id='image-studio-resolution'
        label={t('Resolution')}
        value={props.config.resolution}
        options={display.resolutions.map(identify)}
        onChange={(resolution) => props.onConfigChange({ resolution })}
        disabled={props.disabled}
      />

      <FieldSelect
        id='image-studio-quality'
        label={t('Quality')}
        value={props.config.quality}
        options={display.qualities.map((quality) => ({
          value: quality,
          label: t(QUALITY_LABEL_KEYS[quality] ?? quality),
        }))}
        onChange={(quality) => props.onConfigChange({ quality })}
        disabled={props.disabled}
      />

      <FieldSelect
        id='image-studio-format'
        label={t('Format')}
        value={props.config.format}
        options={display.formats.map(identify)}
        onChange={(format) => props.onConfigChange({ format })}
        disabled={props.disabled}
      />
    </div>
  )
}
