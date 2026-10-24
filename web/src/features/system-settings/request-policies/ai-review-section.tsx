/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import type { AIReviewSettings } from './defaults'

const aiReviewSchema = z.object({
  'ai_review_setting.enabled': z.boolean(),
  'ai_review_setting.base_url': z.string().trim(),
  'ai_review_setting.api_key': z.string(),
  'ai_review_setting.model_name': z.string().trim(),
  'ai_review_setting.timeout_seconds': z.coerce
    .number()
    .int()
    .min(5)
    .max(600),
  'ai_review_setting.sample_rate': z.coerce.number().min(0).max(1),
  'ai_review_setting.excluded_groups': z.array(z.string()),
  'ai_review_setting.max_excerpt_chars': z.coerce
    .number()
    .int()
    .min(1000)
    .max(20000),
  'ai_review_setting.review_sensitive_hits': z.boolean(),
  'ai_review_setting.min_confidence': z.coerce.number().min(0).max(1),
  'ai_review_setting.policy_text': z.string(),
  'ai_review_setting.auto_ban_enabled': z.boolean(),
  'ai_review_setting.auto_ban_threshold': z.coerce.number().int().min(1).max(10000),
  'ai_review_setting.auto_ban_window_days': z.coerce.number().int().min(1).max(3650),
  'ai_review_setting.notify_admin_enabled': z.boolean(),
})

type AIReviewFormValues = z.output<typeof aiReviewSchema>
type AIReviewFormInput = z.input<typeof aiReviewSchema>

type AIReviewSectionProps = {
  defaultValues: AIReviewSettings
}

export function AIReviewSection({ defaultValues }: AIReviewSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const queryClient = useQueryClient()
  const { data: groupsData, isLoading: isLoadingGroups } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
    staleTime: 5 * 60 * 1000,
  })

  const formDefaults = useMemo<AIReviewFormValues>(
    () => ({
      'ai_review_setting.enabled': defaultValues['ai_review_setting.enabled'],
      'ai_review_setting.base_url': defaultValues['ai_review_setting.base_url'],
      // 密钥不回显：输入框永远从空开始，留空提交表示保留已配置的密钥。
      'ai_review_setting.api_key': '',
      'ai_review_setting.model_name':
        defaultValues['ai_review_setting.model_name'],
      'ai_review_setting.timeout_seconds':
        defaultValues['ai_review_setting.timeout_seconds'],
      'ai_review_setting.sample_rate':
        defaultValues['ai_review_setting.sample_rate'],
      'ai_review_setting.excluded_groups': Array.isArray(
        defaultValues['ai_review_setting.excluded_groups']
      )
        ? defaultValues['ai_review_setting.excluded_groups']
        : [],
      'ai_review_setting.max_excerpt_chars':
        defaultValues['ai_review_setting.max_excerpt_chars'],
      'ai_review_setting.review_sensitive_hits':
        defaultValues['ai_review_setting.review_sensitive_hits'],
      'ai_review_setting.min_confidence':
        defaultValues['ai_review_setting.min_confidence'],
      'ai_review_setting.policy_text':
        defaultValues['ai_review_setting.policy_text'],
      'ai_review_setting.auto_ban_enabled':
        defaultValues['ai_review_setting.auto_ban_enabled'],
      'ai_review_setting.auto_ban_threshold':
        defaultValues['ai_review_setting.auto_ban_threshold'],
      'ai_review_setting.auto_ban_window_days':
        defaultValues['ai_review_setting.auto_ban_window_days'],
      'ai_review_setting.notify_admin_enabled':
        defaultValues['ai_review_setting.notify_admin_enabled'],
    }),
    [defaultValues]
  )
  const form = useForm<AIReviewFormInput, unknown, AIReviewFormValues>({
    resolver: zodResolver(aiReviewSchema),
    defaultValues: formDefaults,
  })

  useEffect(() => {
    form.reset(formDefaults)
  }, [formDefaults, form])

  const excludedGroups = form.watch('ai_review_setting.excluded_groups')
  const enabled = form.watch('ai_review_setting.enabled')
  const apiKeyConfigured = defaultValues['ai_review_setting.api_key_configured']
  const knownGroups = useMemo(
    () => (Array.isArray(groupsData?.data) ? groupsData.data : []),
    [groupsData]
  )
  const groupOptions = useMemo(
    () =>
      [...new Set([...knownGroups, ...excludedGroups])]
        .sort((a, b) => a.localeCompare(b))
        .map((group) => ({ value: group, label: group })),
    [excludedGroups, knownGroups]
  )

  const onSubmit = async (values: AIReviewFormValues) => {
    const updates: { key: string; value: string }[] = []
    for (const [key, value] of Object.entries(values)) {
      if (key === 'ai_review_setting.api_key') {
        // 留空表示保留已配置密钥；只有输入了新值才提交。
        if (String(value).trim() !== '') {
          updates.push({ key, value: String(value).trim() })
        }
        continue
      }
      const defaultValue =
        formDefaults[key as keyof AIReviewFormValues] as unknown
      const encoded = Array.isArray(value)
        ? JSON.stringify(value)
        : String(value ?? '')
      if (encoded !== String(defaultValue ?? '')) {
        updates.push({ key, value: encoded })
      }
    }
    try {
      for (const update of updates) {
        await updateOption.mutateAsync(update)
      }
      if (updates.length > 0) {
        // 刷新 api_key_configured 等派生状态。
        void queryClient.invalidateQueries({ queryKey: ['system-options'] })
      }
    } catch (error) {
      handleServerError(error)
    }
  }

  return (
    <SettingsSection title={t('AI content review')}>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Reviews run asynchronously after responses complete and never block or slow requests. Only flagged records and sensitive-word hits are stored; sampled requests judged clean are discarded.'
        )}
      </p>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={form.formState.isSubmitting}
            saveLabel='Save AI review settings'
          />
          <SettingsControlGroup>
            <FormField
              control={form.control}
              name='ai_review_setting.enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Enable AI review')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Sample a fraction of requests and review them with an OpenAI-compatible model after the response completes.'
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
                name='ai_review_setting.review_sensitive_hits'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Review sensitive-word hits')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Also send requests blocked by sensitive words for AI review to spot false positives in the word list.'
                        )}
                      </FormDescription>
                    </SettingsSwitchContent>
                    <FormControl>
                      <Switch
                        disabled={!enabled}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </SettingsSwitchItem>
                )}
              />
              <FormField
                control={form.control}
                name='ai_review_setting.auto_ban_enabled'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Auto-ban repeat offenders')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Bans the user once flagged reviews reach the threshold within the window. The ban reason is recorded as ai_review_violation. Keep it off if you prefer manual review only.'
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
                name='ai_review_setting.notify_admin_enabled'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Notify administrators')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Sends a notice to administrators who enabled AI review notifications in their personal settings.'
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

          <div className='grid gap-4 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='ai_review_setting.base_url'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('API base URL')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='https://api.openai.com'
                      disabled={!enabled}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('OpenAI-compatible endpoint, with or without /v1.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='ai_review_setting.model_name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Review model')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='gpt-4o-mini'
                      disabled={!enabled}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('A cheap and fast model is enough for classification.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='ai_review_setting.api_key'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('API key')}</FormLabel>
                  <FormControl>
                    <Input
                      type='password'
                      autoComplete='new-password'
                      placeholder={
                        apiKeyConfigured
                          ? t('Configured. Leave blank to keep the current key.')
                          : 'sk-...'
                      }
                      disabled={!enabled}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {apiKeyConfigured
                      ? t('A key is configured. Leave blank to keep it.')
                      : t('Not configured yet.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='ai_review_setting.sample_rate'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Sample rate')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      max={1}
                      step={0.01}
                      disabled={!enabled}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Fraction of requests sampled for review, 0 to 1. Higher values cost more.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='ai_review_setting.timeout_seconds'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Review timeout (seconds)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={5}
                      max={600}
                      step={1}
                      disabled={!enabled}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='ai_review_setting.max_excerpt_chars'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Excerpt limit (characters)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={1000}
                      max={20000}
                      step={100}
                      disabled={!enabled}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Only the first part of each request is reviewed. Very large contexts are covered from the beginning only.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='ai_review_setting.min_confidence'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Minimum confidence')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      max={1}
                      step={0.05}
                      disabled={!enabled}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Flagged results below this confidence are not recorded as violations.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='ai_review_setting.auto_ban_threshold'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Auto-ban threshold')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={1}
                      max={10000}
                      step={1}
                      disabled={!enabled}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='ai_review_setting.auto_ban_window_days'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Auto-ban window (days)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={1}
                      max={3650}
                      step={1}
                      disabled={!enabled}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name='ai_review_setting.excluded_groups'
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
                    disabled={isLoadingGroups || !enabled}
                    maxVisibleChips={4}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Requests using these groups are never sampled for AI review.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='ai_review_setting.policy_text'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Additional review policy')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={4}
                    disabled={!enabled}
                    placeholder={t(
                      'Optional extra rules appended to the reviewer instructions.'
                    )}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
