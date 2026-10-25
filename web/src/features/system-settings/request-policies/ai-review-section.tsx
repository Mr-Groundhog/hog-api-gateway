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
import { PlugZap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { MultiSelect } from '@/components/multi-select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  SettingsForm,
  SettingsControlGroup,
  SettingsControlChildren,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { safeNumberFieldProps } from '../utils/numeric-field'
import { saveAIReviewOptions, testAIReviewConnection } from './api'
import type { AIReviewSettings } from './defaults'

// 配置项名形如 `ai_review_setting.timeout_seconds`，而 react-hook-form 把 `.`
// 当作嵌套路径。表单因此按真实的分组结构嵌套；若沿用带点的扁平键名，编辑值会
// 写进一个名为 `ai_review_setting` 的对象里，提交时读到的仍是扁平键的默认值。
const createAIReviewSchema = (t: (key: string) => string) =>
  z.object({
    ai_review_setting: z.object({
      enabled: z.boolean(),
      base_url: z
        .string()
        .trim()
        .refine(
          (value) => value === '' || isHttpUrl(value),
          t('Enter an http(s) URL')
        ),
      full_url_enabled: z.boolean(),
      api_key: z.string(),
      model_name: z.string().trim(),
      timeout_seconds: z.coerce.number().int().min(5).max(600),
      sample_rate: z.coerce.number().min(0).max(1),
      excluded_groups: z.array(z.string()),
      max_excerpt_chars: z.coerce.number().int().min(1000).max(20000),
      review_sensitive_hits: z.boolean(),
      record_clean_samples: z.boolean(),
      min_confidence: z.coerce.number().min(0).max(1),
      policy_text: z.string(),
      force_json_response: z.boolean(),
      custom_request_body: z
        .string()
        .trim()
        .refine(
          (value) => value === '' || isJsonObject(value),
          t('Enter a JSON object')
        )
        .refine(
          (value) =>
            value === '' || !/"(messages|model|stream)"\s*:/.test(value),
          t('Custom request parameters must not set messages, model or stream')
        ),
      auto_ban_enabled: z.boolean(),
      auto_ban_threshold: z.coerce.number().int().min(1).max(10000),
      auto_ban_window_days: z.coerce.number().int().min(1).max(3650),
      notify_admin_enabled: z.boolean(),
    }),
  })

type AIReviewSchema = ReturnType<typeof createAIReviewSchema>
type AIReviewFormValues = z.output<AIReviewSchema>
type AIReviewFormInput = z.input<AIReviewSchema>

// 参与保存比较的字段，顺序即写入顺序。密钥单独处理：它不回显，留空表示保留。
const AI_REVIEW_KEYS = [
  'enabled',
  'base_url',
  'full_url_enabled',
  'model_name',
  'timeout_seconds',
  'sample_rate',
  'excluded_groups',
  'max_excerpt_chars',
  'review_sensitive_hits',
  'record_clean_samples',
  'min_confidence',
  'policy_text',
  'force_json_response',
  'custom_request_body',
  'auto_ban_enabled',
  'auto_ban_threshold',
  'auto_ban_window_days',
  'notify_admin_enabled',
] as const

type AIReviewKey = (typeof AI_REVIEW_KEYS)[number]

type AIReviewSectionProps = {
  defaultValues: AIReviewSettings
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.host !== ''
    )
  } catch {
    return false
  }
}

// 自定义请求参数必须是 JSON 对象；空字符串表示未配置。
function isJsonObject(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value)
    return (
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    )
  } catch {
    return false
  }
}

// 排除分组以 JSON 数组存储，读取时可能拿到字符串或损坏内容；表单与分组
// 选择器都要求数组，这里统一收敛。
function normalizeExcludedGroups(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function buildFormDefaults(defaults: AIReviewSettings): AIReviewFormInput {
  return {
    ai_review_setting: {
      enabled: defaults['ai_review_setting.enabled'],
      base_url: defaults['ai_review_setting.base_url'],
      full_url_enabled: defaults['ai_review_setting.full_url_enabled'],
      // 密钥不回显：输入框永远从空开始，留空提交表示保留已配置的密钥。
      api_key: '',
      model_name: defaults['ai_review_setting.model_name'],
      // z.coerce 的输入类型是 unknown，默认值必须是数字才能通过校验。
      timeout_seconds: defaults['ai_review_setting.timeout_seconds'],
      sample_rate: defaults['ai_review_setting.sample_rate'],
      excluded_groups: normalizeExcludedGroups(
        defaults['ai_review_setting.excluded_groups']
      ),
      max_excerpt_chars: defaults['ai_review_setting.max_excerpt_chars'],
      review_sensitive_hits:
        defaults['ai_review_setting.review_sensitive_hits'],
      record_clean_samples: defaults['ai_review_setting.record_clean_samples'],
      min_confidence: defaults['ai_review_setting.min_confidence'],
      policy_text: defaults['ai_review_setting.policy_text'],
      force_json_response:
        defaults['ai_review_setting.force_json_response'] ?? true,
      custom_request_body:
        defaults['ai_review_setting.custom_request_body'] ?? '',
      auto_ban_enabled: defaults['ai_review_setting.auto_ban_enabled'],
      auto_ban_threshold: defaults['ai_review_setting.auto_ban_threshold'],
      auto_ban_window_days: defaults['ai_review_setting.auto_ban_window_days'],
      notify_admin_enabled: defaults['ai_review_setting.notify_admin_enabled'],
    },
  }
}

// 编码为选项表的字符串形式，用于比较“是否真的改过”并作为提交值。
function encodeFormValues(
  values: AIReviewFormValues | AIReviewFormInput
): Record<AIReviewKey, string> {
  const field = values.ai_review_setting
  const encoded = {} as Record<AIReviewKey, string>
  for (const key of AI_REVIEW_KEYS) {
    const value = field[key]
    encoded[key] = Array.isArray(value)
      ? JSON.stringify(value)
      : String(value ?? '')
  }
  return encoded
}

function encodeDefaults(defaults: AIReviewSettings) {
  return encodeFormValues(buildFormDefaults(defaults))
}

export function AIReviewSection({ defaultValues }: AIReviewSectionProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const aiReviewSchema = createAIReviewSchema(t)
  const baselineRef = useRef(encodeDefaults(defaultValues))
  const [isTesting, setIsTesting] = useState(false)
  const { data: groupsData, isLoading: isLoadingGroups } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
    staleTime: 5 * 60 * 1000,
  })

  const formDefaults = useMemo(
    () => buildFormDefaults(defaultValues),
    [defaultValues]
  )
  const form = useForm<AIReviewFormInput, unknown, AIReviewFormValues>({
    resolver: zodResolver(aiReviewSchema),
    defaultValues: formDefaults,
  })

  // 选项被重新拉取（保存其他设置、其他管理员改动）时同步表单，但只在默认值
  // 真的变化、且没有未保存编辑时才重置：一是避免外部刷新丢弃正在填写的配置，
  // 二是保存后自身触发的刷新不应把刚写入的值冲回旧值。
  const lastDefaultsRef = useRef(JSON.stringify(formDefaults))
  const isDirty = form.formState.isDirty
  useEffect(() => {
    const serializedDefaults = JSON.stringify(formDefaults)
    if (serializedDefaults === lastDefaultsRef.current) return
    if (isDirty) return
    lastDefaultsRef.current = serializedDefaults
    form.reset(formDefaults)
  }, [form, formDefaults, isDirty])
  useEffect(() => {
    baselineRef.current = encodeDefaults(defaultValues)
  }, [defaultValues])

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
    const encoded = encodeFormValues(values)
    const updates = AI_REVIEW_KEYS.filter(
      (key) => encoded[key] !== baselineRef.current[key]
    )
    const apiKey = values.ai_review_setting.api_key.trim()
    if (updates.length === 0 && apiKey === '') {
      toast.info(t('No changes to save'))
      return
    }
    try {
      const options: Record<string, string> = {}
      for (const key of updates) {
        options[`ai_review_setting.${key}`] = encoded[key]
      }
      if (apiKey !== '') {
        options['ai_review_setting.api_key'] = apiKey
      }
      await saveAIReviewOptions(options)
      baselineRef.current = encoded
      // 保存成功后用已保存的值重置表单，清掉 dirty 标记，后续外部刷新才能
      // 正常同步；密钥输入框回到留空状态。
      form.reset({
        ai_review_setting: { ...values.ai_review_setting, api_key: '' },
      })
      // 刷新 api_key_configured 等派生状态。
      void queryClient.invalidateQueries({ queryKey: ['system-options'] })
      toast.success(t('Saved successfully'))
    } catch (error) {
      handleServerError(error)
    }
  }

  const onTestConnection = async () => {
    const values = form.getValues().ai_review_setting
    const baseUrl = values.base_url.trim()
    const modelName = values.model_name.trim()
    const apiKey = values.api_key.trim()
    if (
      baseUrl === '' ||
      modelName === '' ||
      (apiKey === '' && !apiKeyConfigured)
    ) {
      toast.error(
        t('Fill in the API base URL, API key and review model before testing.')
      )
      return
    }
    setIsTesting(true)
    try {
      const response = requireServerSuccess(
        await testAIReviewConnection({
          base_url: baseUrl,
          full_url_enabled: values.full_url_enabled,
          model_name: modelName,
          // 留空时由后端使用已保存的密钥。
          api_key: apiKey,
          custom_request_body: values.custom_request_body.trim(),
        })
      )
      toast.success(
        t('Connection succeeded. Model reply: {{reply}}', {
          reply: response.data.reply,
        })
      )
    } catch (error) {
      handleServerError(error, t('Connection failed'))
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <SettingsSection title={t('AI content review')}>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Reviews run asynchronously after responses complete and never block or slow requests. Flagged records and sensitive-word hits are always stored; clean sampled requests are stored only when record clean sample results is enabled.'
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
                name='ai_review_setting.record_clean_samples'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Record clean sample results')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Also store sampled requests judged clean, and sampled calls that failed, so every sampled request can be traced. At a sample rate of 1 this writes one record per request.'
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
                      placeholder={
                        form.watch('ai_review_setting.full_url_enabled')
                          ? 'https://maas.example.com/v2/chat/completions'
                          : 'https://api.openai.com'
                      }
                      disabled={!enabled}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {form.watch('ai_review_setting.full_url_enabled')
                      ? t(
                          'Requests are sent to this exact URL, without any path appended.'
                        )
                      : t('OpenAI-compatible endpoint, with or without /v1.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='ai_review_setting.full_url_enabled'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Use full request URL')}</FormLabel>
                  <FormControl>
                    <Switch
                      disabled={!enabled}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Enable when the provider endpoint is not /v1/chat/completions, for example /v2/chat/completions. The URL above is then used as-is.'
                    )}
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
                          ? t(
                              'Configured. Leave blank to keep the current key.'
                            )
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
                      {...safeNumberFieldProps(field)}
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
                      {...safeNumberFieldProps(field)}
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
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Prioritizes recent user requests and tool or skill content, with limited space for system prompts. Long content is sampled from both ends and omissions are marked.'
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
                      {...safeNumberFieldProps(field)}
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
                      {...safeNumberFieldProps(field)}
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
                      {...safeNumberFieldProps(field)}
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

          <FormField
            control={form.control}
            name='ai_review_setting.force_json_response'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Force JSON output')}</FormLabel>
                <FormControl>
                  <Switch
                    disabled={!enabled}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Sends response_format json_object so the endpoint must return JSON. If the provider rejects the parameter, the request is retried once without it.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='ai_review_setting.custom_request_body'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Custom request parameters')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={6}
                    disabled={!enabled}
                    className='font-mono text-xs'
                    placeholder={`{\n  "text": {\n    "format": {\n      "type": "json_object"\n    }\n  }\n}`}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'A JSON object merged into every review request, for provider-specific parameters such as text.format. It overrides built-in values; messages, model and stream are not allowed.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <Alert>
            <AlertDescription className='flex flex-col items-start gap-2'>
              <span>
                {t(
                  'The test sends one short chat completion with the values above. Save to keep them.'
                )}
              </span>
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={onTestConnection}
                disabled={!enabled || isTesting}
              >
                <PlugZap data-icon='inline-start' />
                <span>{t(isTesting ? 'Testing...' : 'Test connection')}</span>
              </Button>
            </AlertDescription>
          </Alert>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
