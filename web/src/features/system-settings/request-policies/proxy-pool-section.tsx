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
import { useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

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

import {
  SettingsForm,
  SettingsFormGrid,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'
import type { ProxyPoolSettings } from './defaults'

const MIN_AUTO_CHECK_MINUTES = 1
const MAX_AUTO_CHECK_MINUTES = 1440

const createProxyPoolSchema = (
  t: (key: string, options?: Record<string, unknown>) => string
) =>
  z.object({
    proxy_pool_setting: z.object({
      auto_check_enabled: z.boolean(),
      auto_check_minutes: z.coerce
        .number()
        .int()
        .min(MIN_AUTO_CHECK_MINUTES, t('Interval must be at least 1 minute'))
        .max(
          MAX_AUTO_CHECK_MINUTES,
          t('Interval must be at most 1440 minutes')
        ),
    }),
  })

type ProxyPoolSchema = ReturnType<typeof createProxyPoolSchema>
type ProxyPoolFormValues = z.output<ProxyPoolSchema>
type ProxyPoolFormInput = z.input<ProxyPoolSchema>

type ProxyPoolSectionProps = {
  defaultValues: ProxyPoolSettings
}

const buildFormDefaults = (
  defaults: ProxyPoolSectionProps['defaultValues']
): ProxyPoolFormInput => ({
  proxy_pool_setting: {
    auto_check_enabled: defaults['proxy_pool_setting.auto_check_enabled'],
    auto_check_minutes: defaults['proxy_pool_setting.auto_check_minutes'],
  },
})

const normalizeDefaults = (
  defaults: ProxyPoolSectionProps['defaultValues']
): ProxyPoolSettings => ({
  'proxy_pool_setting.auto_check_enabled':
    defaults['proxy_pool_setting.auto_check_enabled'],
  'proxy_pool_setting.auto_check_minutes':
    defaults['proxy_pool_setting.auto_check_minutes'],
})

const normalizeFormValues = (
  values: ProxyPoolFormValues
): ProxyPoolSettings => ({
  'proxy_pool_setting.auto_check_enabled':
    values.proxy_pool_setting.auto_check_enabled,
  'proxy_pool_setting.auto_check_minutes':
    values.proxy_pool_setting.auto_check_minutes,
})

export function ProxyPoolSection({ defaultValues }: ProxyPoolSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const baselineRef = useRef<ProxyPoolSettings>(normalizeDefaults(defaultValues))

  const formDefaults = useMemo(
    () => buildFormDefaults(defaultValues),
    [defaultValues]
  )

  const form = useForm<ProxyPoolFormInput, unknown, ProxyPoolFormValues>({
    resolver: zodResolver(createProxyPoolSchema(t)),
    defaultValues: formDefaults,
  })

  useResetForm(form, formDefaults)
  useEffect(() => {
    baselineRef.current = normalizeDefaults(defaultValues)
  }, [defaultValues])

  const autoCheckEnabled = form.watch(
    'proxy_pool_setting.auto_check_enabled'
  )

  const onSubmit = async (values: ProxyPoolFormValues) => {
    const normalized = normalizeFormValues(values)
    const updates = (
      Object.keys(normalized) as Array<keyof ProxyPoolSettings>
    ).filter((key) => normalized[key] !== baselineRef.current[key])

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const key of updates) {
      await updateOption.mutateAsync({
        key,
        value: normalized[key],
      })
    }

    baselineRef.current = normalized
  }

  return (
    <SettingsSection title={t('Proxy Pool')}>
      <div className='text-muted-foreground space-y-1 text-sm'>
        <p>{t('Source: global settings. Changes take effect after saving.')}</p>
        <p>
          {t(
            'The scheduled check tests enabled pool entries only and updates their latency, exit IP and failure state.'
          )}
        </p>
      </div>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />

          <SettingsFormGrid>
            <FormField
              control={form.control}
              name='proxy_pool_setting.auto_check_enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Scheduled proxy checks')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Periodically check whether every enabled proxy in the pool is reachable'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />

            <FormField
              control={form.control}
              name='proxy_pool_setting.auto_check_minutes'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Check interval (minutes)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={MIN_AUTO_CHECK_MINUTES}
                      max={MAX_AUTO_CHECK_MINUTES}
                      step={1}
                      {...safeNumberFieldProps(field)}
                      disabled={!autoCheckEnabled}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Time between scheduled proxy checks')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsFormGrid>

          <div className='text-muted-foreground text-xs'>
            {t(
              'The check address and timeout stay on the PROXY_POOL_CHECK_URL and PROXY_POOL_CHECK_TIMEOUT environment variables.'
            )}
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
