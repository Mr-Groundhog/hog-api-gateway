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
import { useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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

/**
 * Probe guard options are stored under dotted keys, but react-hook-form treats a
 * dot in a field name as a nested path. The form therefore works on a nested
 * `probe_guard` object and is normalized back to the flat option keys before the
 * values are sent to the option API.
 */
const probeGuardSchema = z.object({
  probe_guard: z.object({
    enabled: z.boolean(),
    dry_run: z.boolean(),
    window_seconds: z.number().int().min(1).max(3600),
    model_threshold: z.number().int().min(2).max(100),
    max_triggers: z.number().int().min(1).max(10),
    excluded_groups: z.array(z.string()),
    whitelist_user_ids: z.string(),
  }),
})

type ProbeGuardFormValues = z.output<typeof probeGuardSchema>
type ProbeGuardFormInput = z.input<typeof probeGuardSchema>

type ProbeGuardOptionValues = {
  'probe_guard.enabled': boolean
  'probe_guard.dry_run': boolean
  'probe_guard.window_seconds': number
  'probe_guard.model_threshold': number
  'probe_guard.max_triggers': number
  'probe_guard.excluded_groups': string[]
  'probe_guard.whitelist_user_ids': string
}

type ProbeGuardSectionProps = {
  defaultValues: ProbeGuardOptionValues
}

const buildFormDefaults = (
  defaults: ProbeGuardOptionValues
): ProbeGuardFormInput => ({
  probe_guard: {
    enabled: defaults['probe_guard.enabled'],
    dry_run: defaults['probe_guard.dry_run'],
    window_seconds: defaults['probe_guard.window_seconds'],
    model_threshold: defaults['probe_guard.model_threshold'],
    max_triggers: defaults['probe_guard.max_triggers'],
    excluded_groups: defaults['probe_guard.excluded_groups'],
    whitelist_user_ids: defaults['probe_guard.whitelist_user_ids'],
  },
})

const normalizeFormValues = (
  values: ProbeGuardFormValues
): ProbeGuardOptionValues => ({
  'probe_guard.enabled': values.probe_guard.enabled,
  'probe_guard.dry_run': values.probe_guard.dry_run,
  'probe_guard.window_seconds': values.probe_guard.window_seconds,
  'probe_guard.model_threshold': values.probe_guard.model_threshold,
  'probe_guard.max_triggers': values.probe_guard.max_triggers,
  'probe_guard.excluded_groups': values.probe_guard.excluded_groups,
  'probe_guard.whitelist_user_ids':
    values.probe_guard.whitelist_user_ids.trim(),
})

const isEqual = (a: unknown, b: unknown) => {
  if (Array.isArray(a) && Array.isArray(b)) {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return a === b
}

export function ProbeGuardSection({ defaultValues }: ProbeGuardSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const baselineRef = useRef<ProbeGuardOptionValues>(defaultValues)
  const form = useForm<ProbeGuardFormInput, unknown, ProbeGuardFormValues>({
    resolver: zodResolver(probeGuardSchema),
    defaultValues: buildFormDefaults(defaultValues),
  })
  const { data: groupsData, isLoading: isLoadingGroups } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
    staleTime: 5 * 60 * 1000,
  })

  const excludedGroups = form.watch('probe_guard.excluded_groups')
  const groupOptions = useMemo(
    () =>
      [...new Set([...(groupsData?.data ?? []), ...(excludedGroups ?? [])])]
        .sort((a, b) => a.localeCompare(b))
        .map((group) => ({ value: group, label: group })),
    [excludedGroups, groupsData?.data]
  )

  useEffect(() => {
    baselineRef.current = defaultValues
    form.reset(buildFormDefaults(defaultValues))
  }, [defaultValues, form])

  const onSubmit = async (values: ProbeGuardFormValues) => {
    const normalized = normalizeFormValues(values)
    const changedKeys = (
      Object.keys(normalized) as Array<keyof ProbeGuardOptionValues>
    ).filter((key) => !isEqual(normalized[key], baselineRef.current[key]))

    if (changedKeys.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const key of changedKeys) {
      const value = normalized[key]
      await updateOption.mutateAsync({
        key,
        value: Array.isArray(value) ? JSON.stringify(value) : value,
      })
    }

    baselineRef.current = normalized
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
