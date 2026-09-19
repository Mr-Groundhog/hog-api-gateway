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
import { ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PasswordInput } from '@/components/password-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { CUSTOM_ENDPOINT_PLACEHOLDER } from '../constants'
import { resolveApiBaseUrl } from '../lib/custom-endpoint'
import type { CustomEndpoint } from '../types'

interface ImageCustomEndpointFieldsProps {
  endpoint: CustomEndpoint
  onChange: (patch: Partial<CustomEndpoint>) => void
  disabled?: boolean
}

/** Address and key of the user's own endpoint, plus what we do with them. */
export function ImageCustomEndpointFields(
  props: ImageCustomEndpointFieldsProps
) {
  const { t } = useTranslation()
  const typedUrl = props.endpoint.baseUrl.trim()
  const isUrlInvalid = typedUrl !== '' && resolveApiBaseUrl(typedUrl) === ''

  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <Label htmlFor='image-studio-custom-base-url'>{t('Base URL')}</Label>
        <Input
          id='image-studio-custom-base-url'
          value={props.endpoint.baseUrl}
          onChange={(event) => props.onChange({ baseUrl: event.target.value })}
          placeholder={CUSTOM_ENDPOINT_PLACEHOLDER}
          inputMode='url'
          autoComplete='off'
          spellCheck={false}
          disabled={props.disabled}
          aria-invalid={isUrlInvalid}
        />
        {isUrlInvalid ? (
          <p className='text-destructive text-xs'>
            {t('Enter an http(s) address, for example {{example}}.', {
              example: CUSTOM_ENDPOINT_PLACEHOLDER,
            })}
          </p>
        ) : (
          <p className='text-muted-foreground text-xs'>
            {t(
              'The OpenAI-compatible API root. `/v1` is appended when the address does not already end with a version.'
            )}
          </p>
        )}
      </div>

      <div className='space-y-2'>
        <Label htmlFor='image-studio-custom-key'>{t('API Key')}</Label>
        <PasswordInput
          id='image-studio-custom-key'
          value={props.endpoint.apiKey}
          onChange={(event) => props.onChange({ apiKey: event.target.value })}
          placeholder={t('Your own API key')}
          autoComplete='off'
          spellCheck={false}
          disabled={props.disabled}
        />
      </div>

      <div className='bg-muted/60 flex items-start gap-3 rounded-lg px-3 py-2.5'>
        <ShieldCheck
          aria-hidden='true'
          className='text-primary mt-0.5 size-4 shrink-0'
        />
        <div className='min-w-0 space-y-1 text-xs'>
          <p>
            {t(
              'A custom key is kept in this browser only and is never uploaded to the server.'
            )}
          </p>
          <p className='text-muted-foreground'>
            {t(
              'Generations are sent from your browser straight to the address above, so that endpoint has to allow cross-origin requests.'
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
