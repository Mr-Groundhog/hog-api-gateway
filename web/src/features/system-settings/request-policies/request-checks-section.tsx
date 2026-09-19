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
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Textarea } from '@/components/ui/textarea'
import { getGroups } from '@/features/users/api'
import { handleServerError } from '@/lib/handle-server-error'

import {
  SettingsForm,
  SettingsControlGroup,
  SettingsControlChildren,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { useSavePolicy } from './use-save-policy'

const sensitiveSchema = z.object({
  CheckSensitiveEnabled: z.boolean(),
  CheckSensitiveOnPromptEnabled: z.boolean(),
  SensitiveWordAutoBanEnabled: z.boolean(),
  SensitiveWordAutoBanThreshold: z.number().int().min(1).max(10000),
  SensitiveWords: z.string().optional(),
  SensitiveWordExcludedGroups: z.array(z.string()),
})

type SensitiveFormValues = z.infer<typeof sensitiveSchema>

type RequestChecksSectionProps = {
  defaultValues: SensitiveFormValues
}

// 请求检查面板同时承载上游的策略开关与本仓库扩展的敏感词风控开关：
// 前者由请求策略接口校验并落库，后者仍是普通系统选项。
const POLICY_MANAGED_KEYS = new Set([
  'CheckSensitiveEnabled',
  'CheckSensitiveOnPromptEnabled',
  'SensitiveWords',
])

export function RequestChecksSection({
  defaultValues,
}: RequestChecksSectionProps) {
  const { t } = useTranslation()
  const updatePolicy = useSavePolicy()
  const updateOption = useUpdateOption()
  // 排除分组在选项表中以 JSON 文本存储，未配置或内容损坏时会以字符串到达；
  // 表单与分组选择器都要求数组，这里统一收敛。
  const formDefaults = useMemo<SensitiveFormValues>(
    () => ({
      ...defaultValues,
      SensitiveWordExcludedGroups: Array.isArray(
        defaultValues.SensitiveWordExcludedGroups
      )
        ? defaultValues.SensitiveWordExcludedGroups
        : [],
    }),
    [defaultValues]
  )
  const form = useForm<SensitiveFormValues>({
    resolver: zodResolver(sensitiveSchema),
    defaultValues: formDefaults,
  })
  const { data: groupsData, isLoading: isLoadingGroups } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
    staleTime: 5 * 60 * 1000,
  })

  const excludedGroups = form.watch('SensitiveWordExcludedGroups')
  const autoBanEnabled = form.watch('SensitiveWordAutoBanEnabled')
  const knownGroups = Array.isArray(groupsData?.data) ? groupsData.data : []
  const groupOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...knownGroups,
          ...(Array.isArray(excludedGroups) ? excludedGroups : []),
        ])
      )
        .sort((a, b) => a.localeCompare(b))
        .map((group) => ({ value: group, label: group })),
    [excludedGroups, knownGroups]
  )

  useEffect(() => {
    form.reset(formDefaults)
  }, [formDefaults, form])

  const onSubmit = async (values: SensitiveFormValues) => {
    const updates = Object.entries(values).filter(([key, value]) => {
      const defaultValue = formDefaults[key as keyof SensitiveFormValues]
      if (Array.isArray(value) && Array.isArray(defaultValue)) {
        return JSON.stringify(value) !== JSON.stringify(defaultValue)
      }
      return value !== defaultValue
    })

    const policyUpdates: Record<string, string> = {}
    const optionUpdates: Record<string, string> = {}
    for (const [key, value] of updates) {
      const encoded = Array.isArray(value)
        ? JSON.stringify(value)
        : String(value ?? '')
      if (POLICY_MANAGED_KEYS.has(key)) {
        policyUpdates[key] = encoded
      } else {
        optionUpdates[key] = encoded
      }
    }

    try {
      if (Object.keys(policyUpdates).length > 0) {
        await updatePolicy.mutateAsync(policyUpdates)
      }
      for (const [key, value] of Object.entries(optionUpdates)) {
        await updateOption.mutateAsync({ key, value })
      }
    } catch (error) {
      handleServerError(error)
    }
  }

  return (
    <SettingsSection title={t('Request checks')}>
      <p className='text-muted-foreground text-sm'>
        {t('Source: global settings. Changes take effect after saving.')}
      </p>
      <h3 className='text-sm font-medium'>{t('Request text filtering')}</h3>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Checks text extracted from supported requests against keywords, ignoring case. A match rejects the request before upstream processing and does not affect channel health. Images, audio and generated responses are not checked.'
        )}
      </p>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={form.formState.isSubmitting}
            saveLabel='Save sensitive words'
          />
          <Alert>
            <AlertDescription>
              {form.watch('CheckSensitiveEnabled') &&
              form.watch('CheckSensitiveOnPromptEnabled') &&
              form.watch('SensitiveWords')?.trim()
                ? t(
                    'Prompt text filtering is active with the current form values.'
                  )
                : t(
                    'Prompt text filtering needs both switches enabled and a non-empty keyword list.'
                  )}
            </AlertDescription>
          </Alert>
          <SettingsControlGroup>
            <FormField
              control={form.control}
              name='CheckSensitiveEnabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Enable filtering')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Blocks messages when sensitive keywords are detected.'
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

            <SettingsControlChildren>
              <FormField
                control={form.control}
                name='CheckSensitiveOnPromptEnabled'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Inspect user prompts')}</FormLabel>
                      <FormDescription>
                        {t(
                          'When enabled, prompts are scanned before reaching upstream models.'
                        )}
                      </FormDescription>
                    </SettingsSwitchContent>
                    <FormControl>
                      <Switch
                        disabled={!form.watch('CheckSensitiveEnabled')}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </SettingsSwitchItem>
                )}
              />

              <FormField
                control={form.control}
                name='SensitiveWordAutoBanEnabled'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Auto-ban repeat offenders')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Bans the user once their cumulative sensitive-word trigger count reaches the threshold. The ban reason is recorded as prohibited_words.'
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
            </SettingsControlChildren>
          </SettingsControlGroup>

          <FormField
            control={form.control}
            name='SensitiveWordAutoBanThreshold'
            render={({ field }) => (
              <FormItem className='max-w-xs'>
                <FormLabel>{t('Auto-ban threshold')}</FormLabel>
                <FormControl>
                  <div className='flex items-center gap-2'>
                    <Input
                      type='number'
                      min={1}
                      max={10000}
                      step={1}
                      {...field}
                      disabled={!autoBanEnabled}
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
                    'The user is banned as soon as the cumulative count reaches this value. Resetting the count on the violations page clears it.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='SensitiveWordExcludedGroups'
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
                    'Requests using these groups bypass sensitive word filtering while the global filter remains enabled.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='SensitiveWords'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Blocked keywords')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={12}
                    placeholder={t('Enter one keyword per line')}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Each line represents one keyword. Leave blank to disable the list but keep the switch states.'
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
