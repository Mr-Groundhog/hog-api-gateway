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
import { Gauge, RefreshCw, Sparkles, Square } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Combobox } from '@/components/ui/combobox'
import type { ComboboxInputOption } from '@/components/ui/combobox-input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import type { ImageStudioUsage } from '../api'
import { IMAGE_KEY_SOURCES, PROMPT_MAX_LENGTH } from '../constants'
import type { ImageKeyOption } from '../hooks/use-image-key'
import { resolveApiBaseUrl } from '../lib/custom-endpoint'
import type {
  CustomEndpoint,
  ImageKeySource,
  ImageStudioConfig,
} from '../types'
import { ImageCustomEndpointFields } from './image-custom-endpoint-fields'
import { ImageKeySelect } from './image-key-select'
import { ImageParameterFields } from './image-parameter-fields'
import { ImageSourceSelect } from './image-source-select'

export interface ImagePromptFormProps {
  keys: ImageKeyOption[]
  selectedKey: ImageKeyOption | null
  onSelectKey: (id: number) => void
  models: ComboboxInputOption[]
  /** When true the list comes from drawing settings, so the toggle is moot. */
  isAdminConfigured: boolean
  keySource: ImageKeySource
  onKeySourceChange: (source: ImageKeySource) => void
  customEndpoint: CustomEndpoint
  onCustomEndpointChange: (patch: Partial<CustomEndpoint>) => void
  /** Reloads the model list from the user's own endpoint. */
  onRefreshModels: () => void
  isRefreshingModels: boolean
  modelsError: string | null
  config: ImageStudioConfig
  onConfigChange: (patch: Partial<ImageStudioConfig>) => void
  prompt: string
  onPromptChange: (value: string) => void
  isGenerating: boolean
  canGenerate: boolean
  onGenerate: () => void
  onCancel: () => void
  usage: ImageStudioUsage | undefined
  isUsageLoading: boolean
}

/** Prompt, key, model and parameters — everything one generation needs. */
export function ImagePromptForm(props: ImagePromptFormProps) {
  const { t } = useTranslation()
  const isPromptAtLimit = props.prompt.length >= PROMPT_MAX_LENGTH
  const isCustomSource = props.keySource === IMAGE_KEY_SOURCES.CUSTOM
  const canRefreshModels =
    !props.isGenerating &&
    resolveApiBaseUrl(props.customEndpoint.baseUrl) !== '' &&
    props.customEndpoint.apiKey.trim() !== ''

  let usageSummary: ReactNode
  if (props.isUsageLoading) {
    usageSummary = (
      <span className='text-muted-foreground'>{t('Loading...')}</span>
    )
  } else if (props.usage === undefined) {
    usageSummary = (
      <span className='text-muted-foreground'>{t('Loading failed')}</span>
    )
  } else if (props.usage.unlimited) {
    usageSummary = (
      <div className='flex flex-wrap gap-x-3 gap-y-1'>
        <span>
          {t('Today')}: {t('Unlimited')}
        </span>
        <span className='text-muted-foreground'>
          {t('Used')}: {props.usage.used}
        </span>
      </div>
    )
  } else {
    usageSummary = (
      <div className='flex flex-wrap gap-x-3 gap-y-1'>
        <span className='font-medium'>
          {t('Remaining')}: {props.usage.remaining}
        </span>
        <span className='text-muted-foreground'>
          {t('Used')}: {props.usage.used} / {props.usage.limit}
        </span>
      </div>
    )
  }

  return (
    <Card className='gap-4'>
      <CardHeader>
        <CardTitle className='text-base'>{t('Generate an image')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        {/* Quota is a property of this site's keys; a custom endpoint is not
            billed here, so the summary would only be misleading. */}
        {isCustomSource ? null : (
          <div className='bg-muted/60 flex items-center gap-3 rounded-lg px-3 py-2.5'>
            <Gauge
              aria-hidden='true'
              className='text-primary size-4 shrink-0'
            />
            <div className='min-w-0 text-sm'>{usageSummary}</div>
          </div>
        )}

        <div className='space-y-2'>
          <div className='text-sm leading-none font-medium'>
            {t('Key source')}
          </div>
          <ImageSourceSelect
            value={props.keySource}
            onChange={props.onKeySourceChange}
            disabled={props.isGenerating}
          />
        </div>

        {isCustomSource ? (
          <ImageCustomEndpointFields
            endpoint={props.customEndpoint}
            onChange={props.onCustomEndpointChange}
            disabled={props.isGenerating}
          />
        ) : (
          <div className='space-y-2'>
            <Label htmlFor='image-studio-key'>{t('API Key')}</Label>
            <ImageKeySelect
              keys={props.keys}
              selectedKey={props.selectedKey}
              onSelect={props.onSelectKey}
              disabled={props.isGenerating}
            />
          </div>
        )}

        <div className='space-y-2'>
          <div className='flex items-center justify-between gap-4'>
            <Label htmlFor='image-studio-model'>{t('Model')}</Label>
            {!isCustomSource && !props.isAdminConfigured ? (
              <div className='flex items-center gap-2'>
                <Switch
                  id='image-studio-show-all-models'
                  checked={props.config.showAllModels}
                  onCheckedChange={(checked) =>
                    props.onConfigChange({ showAllModels: checked })
                  }
                  disabled={props.isGenerating}
                />
                <Label
                  htmlFor='image-studio-show-all-models'
                  className='text-muted-foreground text-xs font-normal'
                >
                  {t('Show all models')}
                </Label>
              </div>
            ) : null}
          </div>
          <div className='flex items-center gap-2'>
            <Combobox
              id='image-studio-model'
              className='flex-1'
              options={props.models}
              value={props.config.model}
              onValueChange={(value) =>
                props.onConfigChange({ model: value ?? '' })
              }
              placeholder={t('Select a model')}
              searchPlaceholder={t('Search models...')}
              emptyText={t('No models available')}
              disabled={props.isGenerating}
            />
            {isCustomSource ? (
              <Button
                type='button'
                variant='outline'
                size='icon'
                onClick={props.onRefreshModels}
                disabled={!canRefreshModels}
                aria-label={t('Refresh models')}
                title={t('Refresh models')}
              >
                <RefreshCw
                  aria-hidden='true'
                  className={cn(
                    'size-4',
                    props.isRefreshingModels && 'animate-spin'
                  )}
                />
              </Button>
            ) : null}
          </div>
          {props.modelsError ? (
            <p className='text-destructive text-xs'>{props.modelsError}</p>
          ) : null}
          {isCustomSource && !props.modelsError && props.models.length === 0 ? (
            <p className='text-muted-foreground text-xs'>
              {t(
                'Fill in the base URL and the key, then refresh to load the models the endpoint serves.'
              )}
            </p>
          ) : null}
          <p className='text-muted-foreground text-xs'>
            {t(
              'These settings are generic; what the selected model actually accepts takes precedence.'
            )}
          </p>
        </div>

        <ImageParameterFields
          config={props.config}
          onConfigChange={props.onConfigChange}
          disabled={props.isGenerating}
        />

        <div className='space-y-2'>
          <div className='flex items-center justify-between gap-4'>
            <Label htmlFor='image-studio-prompt'>{t('Prompt')}</Label>
            <span
              className={cn(
                'text-muted-foreground text-xs tabular-nums',
                isPromptAtLimit && 'text-destructive'
              )}
            >
              {t('Characters: {{used}} / {{max}}', {
                used: props.prompt.length,
                max: PROMPT_MAX_LENGTH,
              })}
            </span>
          </div>
          <Textarea
            id='image-studio-prompt'
            value={props.prompt}
            onChange={(event) => props.onPromptChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                if (props.canGenerate) {
                  props.onGenerate()
                }
              }
            }}
            placeholder={t('Describe the image you want to generate')}
            rows={5}
            maxLength={PROMPT_MAX_LENGTH}
            className='min-h-24 resize-y'
            disabled={props.isGenerating}
          />
        </div>
      </CardContent>
      <CardFooter className='gap-2'>
        {props.isGenerating ? (
          <Button type='button' variant='outline' onClick={props.onCancel}>
            <Square aria-hidden='true' className='size-4' />
            {t('Cancel')}
          </Button>
        ) : null}
        <Button
          type='button'
          onClick={props.onGenerate}
          disabled={!props.canGenerate}
        >
          <Sparkles aria-hidden='true' className='size-4' />
          {props.isGenerating ? t('Generating...') : t('Generate')}
        </Button>
      </CardFooter>
    </Card>
  )
}
