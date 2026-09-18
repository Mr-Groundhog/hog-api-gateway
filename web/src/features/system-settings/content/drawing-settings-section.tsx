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
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { MultiSelect } from '@/components/multi-select'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { normalizeJsonString } from './utils'

/** Model ids are stored as a JSON array string, like the other list options. */
const createDrawingSchema = (t: (key: string) => string) =>
  z.object({
    DrawingEnabled: z.boolean(),
    ImageStudioDailyLimit: z.number().int().min(0).max(100000),
    DrawingModels: z.string().superRefine((value, ctx) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(value || '[]')
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('Expected a JSON array of model names.'),
        })
        return
      }
      if (
        !Array.isArray(parsed) ||
        parsed.some((item) => typeof item !== 'string')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('Expected a JSON array of model names.'),
        })
      }
    }),
    MjNotifyEnabled: z.boolean(),
    MjAccountFilterEnabled: z.boolean(),
    MjForwardUrlEnabled: z.boolean(),
    MjModeClearEnabled: z.boolean(),
    MjActionCheckSuccessEnabled: z.boolean(),
  })

type DrawingFormValues = z.infer<ReturnType<typeof createDrawingSchema>>

/** Every field other than the model list is a switch. */
type DrawingSwitchKey = Exclude<
  keyof DrawingFormValues,
  'DrawingModels' | 'ImageStudioDailyLimit'
>

type DrawingSettingsSectionProps = {
  defaultValues: DrawingFormValues
}

/** Parse the stored JSON array, tolerating an empty or corrupted value. */
function parseModelList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]')
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

export function DrawingSettingsSection({
  defaultValues,
}: DrawingSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const schema = useMemo(() => createDrawingSchema(t), [t])
  const form = useForm<DrawingFormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  // Every model the instance knows about, so the admin picks rather than types.
  // `allowCreate` still covers a model missing from the catalogue.
  const { models, isLoading: isLoadingModels } = usePricingData()
  const modelOptions = useMemo(
    () =>
      models
        .map((model) => model.model_name)
        .sort((left, right) => left.localeCompare(right))
        .map((name) => ({ value: name, label: name })),
    [models]
  )

  useEffect(() => {
    form.reset(defaultValues)
  }, [defaultValues, form])

  const onSubmit = async (values: DrawingFormValues) => {
    const normalized: DrawingFormValues = {
      ...values,
      DrawingModels: normalizeJsonString(values.DrawingModels, '[]'),
    }
    const updates = Object.entries(normalized).filter(
      ([key, value]) => value !== defaultValues[key as keyof DrawingFormValues]
    )

    for (const [key, value] of updates) {
      await updateOption.mutateAsync({ key, value })
    }
  }

  const switches: Array<{
    name: DrawingSwitchKey
    label: string
    description: string
  }> = [
    {
      name: 'DrawingEnabled',
      label: t('Enable drawing features'),
      description: t(
        'Required to expose MjProxy-style image generation to end users.'
      ),
    },
    {
      name: 'MjNotifyEnabled',
      label: t('Allow upstream callbacks'),
      description: t(
        'When enabled, MjProxy callbacks are accepted (reveals server IP).'
      ),
    },
    {
      name: 'MjAccountFilterEnabled',
      label: t('Allow accountFilter parameter'),
      description: t(
        'Keep enabled if you need to proxy requests for different upstream accounts.'
      ),
    },
    {
      name: 'MjForwardUrlEnabled',
      label: t('Rewrite callback URLs to the local server'),
      description: t(
        'Automatically replaces upstream callback URLs with the server address.'
      ),
    },
    {
      name: 'MjModeClearEnabled',
      label: t('Clear mode flags in prompts'),
      description: t(
        'Removes MjProxy flags such as --fast, --relax, and --turbo from user prompts.'
      ),
    },
    {
      name: 'MjActionCheckSuccessEnabled',
      label: t('Require job success before follow-up actions'),
      description: t(
        'Users must wait for a successful drawing before upscales or variations.'
      ),
    },
  ]

  return (
    <SettingsSection title={t('Drawing Settings')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save drawing settings'
          />
          <div className='space-y-4'>
            <FormField
              control={form.control}
              name='DrawingModels'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Drawing models')}</FormLabel>
                  <FormControl>
                    <MultiSelect
                      id='drawing-models'
                      options={modelOptions}
                      selected={parseModelList(field.value)}
                      onChange={(values) =>
                        field.onChange(JSON.stringify(values))
                      }
                      placeholder={t('Select models...')}
                      emptyText={t('No matching items')}
                      allowCreate
                      disabled={isLoadingModels}
                      maxVisibleChips={6}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Models offered by the image studio. Leave empty to let users pick from their own group instead.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='ImageStudioDailyLimit'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Daily quota')} ({t('Generate an image')})
                  </FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      max={100000}
                      step={1}
                      value={field.value}
                      onChange={(event) => {
                        const value = event.currentTarget.valueAsNumber
                        field.onChange(Number.isNaN(value) ? 0 : value)
                      }}
                    />
                  </FormControl>
                  <FormDescription>{t('0 means unlimited')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {switches.map((item) => (
              <FormField
                key={item.name}
                control={form.control}
                name={item.name}
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{item.label}</FormLabel>
                      <FormDescription>{item.description}</FormDescription>
                    </SettingsSwitchContent>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </SettingsSwitchItem>
                )}
              />
            ))}
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
