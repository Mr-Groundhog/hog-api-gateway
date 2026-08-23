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
import { useQuery } from '@tanstack/react-query'
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
import { getGroups } from '@/features/users/api'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const probeGuardSchema = z.object({
  'probe_guard.enabled': z.boolean(),
  'probe_guard.dry_run': z.boolean(),
  'probe_guard.window_seconds': z
    .number()
    .int()
    .min(1)
    .max(3600),
  'probe_guard.model_threshold': z
    .number()
    .int()
    .min(2)
    .max(100),
  'probe_guard.max_triggers': z
    .number()
    .int()
    .min(1)
    .max(10),
  'probe_guard.excluded_groups': z.array(z.string()),
  'probe_guard.whitelist_user_ids': z.string(),
})

type ProbeGuardFormValues = z.infer<typeof probeGuardSchema>

type ProbeGuardSectionProps = {
  defaultValues: ProbeGuardFormValues
}

export function ProbeGuardSection({ defaultValues }: ProbeGuardSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const form = useForm<ProbeGuardFormValues>({
    resolver: zodResolver(probeGuardSchema),
    defaultValues,
  })
  const { data: groupsData, isLoading: isLoadingGroups } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
    staleTime: 5 * 60 * 1000,
  })

  const excludedGroups = form.watch('probe_guard.excluded_groups')
  const groupOptions = useMemo(
    () =>
      [...new Set([...(groupsData?.data ?? []), ...excludedGroups])]
        .sort((a, b) => a.localeCompare(b))
        .map((group) => ({ value: group, label: group })),
    [excludedGroups, groupsData?.data]
  )

  useEffect(() => {
    form.reset(defaultValues)
  }, [defaultValues, form])

  const onSubmit = async (values: ProbeGuardFormValues) => {
    const updates = Object.entries(values).filter(([key, value]) => {
      const defaultValue =
        defaultValues[key as keyof ProbeGuardFormValues]
      if (Array.isArray(value) && Array.isArray(defaultValue)) {
        return JSON.stringify(value) !== JSON.stringify(defaultValue)
      }
      return value !== defaultValue
    })

    for (const [key, value] of updates) {
      await updateOption.mutateAsync({
        key,
        value: Array.isArray(value)
          ? JSON.stringify(value)
          : String(value ?? ''),
      })
    }
  }

  return (
    <SettingsSection title={t('Probe Guard')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save probe guard settings'
          />
          <div className='space-y-4'>
            <FormField
              control={form.control}
              name='probe_guard.enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Enable probe guard')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Detects batch model probing (requesting many different models within a short window) and warns or bans the user.'
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
              name='probe_guard.dry_run'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Observation mode (dry run)')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Only records trigger logs without blocking requests or counting penalties. Use this to calibrate thresholds before enabling enforcement.'
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
          </div>

          <div className='grid gap-4 md:grid-cols-3'>
            <FormField
              control={form.control}
              name='probe_guard.window_seconds'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Detection window')}</FormLabel>
                  <FormControl>
                    <div className='flex items-center gap-2'>
                      <Input
                        type='number'
                        min={1}
                        max={3600}
                        step={1}
                        {...field}
                        onChange={(e) =>
                          field.onChange(Number.parseInt(e.target.value) || 0)
                        }
                      />
                      <span className='text-muted-foreground text-sm'>
                        {t('seconds')}
                      </span>
                    </div>
                  </FormControl>
                  <FormDescription>
                    {t('Sliding window used to count distinct models')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='probe_guard.model_threshold'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Distinct model threshold')}</FormLabel>
                  <FormControl>
                    <div className='flex items-center gap-2'>
                      <Input
                        type='number'
                        min={2}
                        max={100}
                        step={1}
                        {...field}
                        onChange={(e) =>
                          field.onChange(Number.parseInt(e.target.value) || 0)
                        }
                      />
                      <span className='text-muted-foreground text-sm'>
                        {t('models')}
                      </span>
                    </div>
                  </FormControl>
                  <FormDescription>
                    {t(
                      'A user is flagged when the distinct model count in the window reaches this value'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='probe_guard.max_triggers'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Allowed triggers')}</FormLabel>
                  <FormControl>
                    <div className='flex items-center gap-2'>
                      <Input
                        type='number'
                        min={1}
                        max={10}
                        step={1}
                        {...field}
                        onChange={(e) =>
                          field.onChange(Number.parseInt(e.target.value) || 0)
                        }
                      />
                      <span className='text-muted-foreground text-sm'>
                        {t('times')}
                      </span>
                    </div>
                  </FormControl>
                  <FormDescription>
                    {t(
                      '1 = ban immediately on first trigger; 2 = warn first, ban on second'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name='probe_guard.excluded_groups'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Excluded groups')}</FormLabel>
                <FormControl>
                  <MultiSelect
                    options={groupOptions}
                    selected={field.value}
                    onChange={field.onChange}
                    placeholder={t('Select groups...')}
                    emptyText={t('No matching items')}
                    disabled={isLoadingGroups}
                    maxVisibleChips={4}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Requests using these groups bypass probe guard detection. Administrators are always exempt.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='probe_guard.whitelist_user_ids'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Whitelist user IDs')}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t('Comma-separated user IDs, e.g. 1,23,456')}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'These users are exempt from probe guard detection. Separate IDs with commas.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
