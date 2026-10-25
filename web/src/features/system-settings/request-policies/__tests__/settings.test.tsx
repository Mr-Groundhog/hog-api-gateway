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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { Route as ModelsRoute } from '@/routes/_authenticated/system-settings/models/$section'
import { Route as OperationsRoute } from '@/routes/_authenticated/system-settings/operations/$section'
import { Route as PoliciesRoute } from '@/routes/_authenticated/system-settings/request-policies/$section'
import { Route as PolicyIndexRoute } from '@/routes/_authenticated/system-settings/request-policies/index'
import { Route as SecurityRoute } from '@/routes/_authenticated/system-settings/security/$section'

import { RequestPolicies } from '..'
import {
  defaultRequestPolicySettings,
  type RequestPolicySettings,
} from '../defaults'

type PolicyBeforeLoad = (context: { params: { section: string } }) => void

let queryClient: QueryClient
let settings: RequestPolicySettings

function optionsResponse() {
  return {
    success: true,
    data: Object.entries(settings).map(([key, value]) => ({
      key,
      value: Array.isArray(value) ? JSON.stringify(value) : String(value),
    })),
  }
}

async function renderPolicies(path: string) {
  const root = createRootRoute()
  const authenticated = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
  })
  const policyRoute = createRoute({
    getParentRoute: () => authenticated,
    path: '/system-settings/request-policies/$section',
    beforeLoad: PoliciesRoute.options.beforeLoad as PolicyBeforeLoad,
    component: RequestPolicies,
  })
  const routes = [
    policyRoute,
    createRoute({
      getParentRoute: () => authenticated,
      path: '/system-settings/request-policies/',
      beforeLoad: PolicyIndexRoute.options.beforeLoad as () => void,
    }),
    createRoute({
      getParentRoute: () => authenticated,
      path: '/system-settings/models/$section',
      beforeLoad: ModelsRoute.options.beforeLoad as PolicyBeforeLoad,
    }),
    createRoute({
      getParentRoute: () => authenticated,
      path: '/system-settings/security/$section',
      beforeLoad: SecurityRoute.options.beforeLoad as PolicyBeforeLoad,
    }),
    createRoute({
      getParentRoute: () => authenticated,
      path: '/system-settings/operations/$section',
      beforeLoad: OperationsRoute.options.beforeLoad as PolicyBeforeLoad,
    }),
  ]
  const router = createRouter({
    routeTree: root.addChildren([authenticated.addChildren(routes)]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await act(() => router.load())
  return router
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  settings = {
    ...defaultRequestPolicySettings,
    RetryTimes: 2,
    AutomaticRetryStatusCodes: '429,500-503',
    AutomaticDisableChannelEnabled: true,
    AutomaticEnableChannelEnabled: true,
    'monitor_setting.auto_test_channel_enabled': true,
    CheckSensitiveEnabled: true,
    CheckSensitiveOnPromptEnabled: true,
    SensitiveWords: 'blocked',
    'channel_affinity_setting.rules': JSON.stringify([
      {
        name: 'Existing session rule',
        model_regex: ['gpt-.*'],
        path_regex: ['/v1/chat/completions'],
        key_sources: [{ type: 'request_header', key: 'X-Session-ID' }],
        ttl_seconds: 600,
        skip_retry_on_failure: true,
        include_using_group: true,
        include_model_name: false,
        include_rule_name: true,
        param_override_template: { temperature: 0 },
      },
    ]),
  }
  vi.spyOn(api, 'patch').mockResolvedValue({
    data: {
      success: true,
      data: { options: {} },
    },
  })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/option/') return { data: optionsResponse() }
    if (url === '/api/group/') {
      return { data: { success: true, data: ['default', 'premium'] } }
    }
    if (url === '/api/option/request_policy') {
      return {
        data: {
          success: true,
          data: {
            options: Object.fromEntries(
              Object.entries(settings).map(([key, value]) => [
                key,
                String(value),
              ])
            ),
          },
        },
      }
    }
    return {
      data: {
        success: true,
        data: {
          enabled: false,
          total: 0,
          unknown: 0,
          by_rule_name: {},
          cache_capacity: 100000,
          cache_algo: 'lru',
        },
      },
    }
  })
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: {
        request_url: 'https://review.example.com/v1/chat/completions',
        request_body: '{"model":"review-model"}',
        status_code: 200,
        content: 'OK',
        raw_response: '{"choices":[{"message":{"content":"OK"}}]}',
        error: '',
      },
    },
  })
})

afterEach(() => {
  cleanup()
  queryClient.clear()
})

describe('request policy settings', () => {
  it('saving AI review retains switches, excluded groups and edited settings after reload', async () => {
    vi.mocked(api.put).mockImplementation(async (_url, body) => {
      const update = body as { key: keyof RequestPolicySettings; value: string }
      Object.assign(settings, { [update.key]: update.value })
      return { data: { success: true } }
    })
    await renderPolicies('/system-settings/request-policies/ai-review')
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Enable AI review' })
    )
    await userEvent.click(
      screen.getByRole('switch', { name: 'Auto-ban repeat offenders' })
    )
    await userEvent.click(
      screen.getByRole('switch', { name: 'Notify administrators' })
    )
    await userEvent.click(
      screen.getByRole('switch', { name: 'Review sensitive-word hits' })
    )
    await userEvent.click(
      screen.getByRole('switch', { name: 'Record clean sample results' })
    )
    for (const [label, value] of [
      ['API base URL', 'https://review.example.com/v1'],
      ['Review model', 'review-model'],
      ['Additional review policy', 'Allow educational examples'],
    ]) {
      fireEvent.change(screen.getByRole('textbox', { name: label }), {
        target: { value },
      })
    }
    for (const [label, value] of [
      ['Sample rate', '0.2'],
      ['Review timeout (seconds)', '30'],
      ['Excerpt limit (characters)', '4000'],
      ['Minimum confidence', '0.8'],
      ['Auto-ban threshold', '5'],
      ['Auto-ban window (days)', '14'],
    ]) {
      fireEvent.change(screen.getByRole('spinbutton', { name: label }), {
        target: { value },
      })
    }
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Select groups...' })
    )
    await userEvent.click(
      await screen.findByRole('option', { name: 'premium' })
    )
    await userEvent.keyboard('{Escape}')
    await userEvent.click(
      screen.getByRole('button', { name: 'Save AI review settings' })
    )
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/option/', {
        key: 'ai_review_setting.excluded_groups',
        value: '["premium"]',
      })
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save AI review settings' })
      ).toBeEnabled()
    )
    // 保存后选项被更新，重新拉取会把表单按新默认值重置，等价于重新进入页面。
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['system-options'] })
    })
    expect(
      await screen.findByRole('switch', { name: 'Enable AI review' })
    ).toBeChecked()
    expect(
      screen.getByRole('switch', { name: 'Auto-ban repeat offenders' })
    ).toBeChecked()
    expect(
      screen.getByRole('switch', { name: 'Notify administrators' })
    ).toBeChecked()
    expect(
      screen.getByRole('switch', { name: 'Review sensitive-word hits' })
    ).not.toBeChecked()
    expect(
      screen.getByRole('switch', { name: 'Record clean sample results' })
    ).toBeChecked()
    expect(screen.getByRole('spinbutton', { name: 'Sample rate' })).toHaveValue(
      0.2
    )
    expect(
      screen.getByRole('spinbutton', { name: 'Review timeout (seconds)' })
    ).toHaveValue(30)
    expect(
      screen.getByRole('spinbutton', { name: 'Excerpt limit (characters)' })
    ).toHaveValue(4000)
    expect(
      screen.getByRole('spinbutton', { name: 'Minimum confidence' })
    ).toHaveValue(0.8)
    expect(
      screen.getByRole('spinbutton', { name: 'Auto-ban threshold' })
    ).toHaveValue(5)
    expect(
      screen.getByRole('spinbutton', { name: 'Auto-ban window (days)' })
    ).toHaveValue(14)
    expect(screen.getByRole('textbox', { name: 'API base URL' })).toHaveValue(
      'https://review.example.com/v1'
    )
    expect(screen.getByRole('textbox', { name: 'Review model' })).toHaveValue(
      'review-model'
    )
    expect(
      screen.getByRole('textbox', { name: 'Additional review policy' })
    ).toHaveValue('Allow educational examples')
    expect(screen.getByText('premium')).toBeVisible()
    vi.mocked(api.put).mockClear()
    await userEvent.click(
      screen.getByRole('button', { name: 'Save AI review settings' })
    )
    expect(api.put).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'testing posts the unsaved form values with force JSON set to %s',
    async (forceJSON) => {
      settings['ai_review_setting.enabled'] = true
      settings['ai_review_setting.force_json_response'] = !forceJSON
      await renderPolicies('/system-settings/request-policies/ai-review')
      fireEvent.change(
        await screen.findByRole('textbox', { name: 'API base URL' }),
        { target: { value: 'https://review.example.com/v1' } }
      )
      fireEvent.change(screen.getByRole('textbox', { name: 'Review model' }), {
        target: { value: 'review-model' },
      })
      fireEvent.change(screen.getByLabelText('API key'), {
        target: { value: 'unsaved-key' },
      })
      await userEvent.click(
        screen.getByRole('switch', { name: 'Force JSON output' })
      )
      await userEvent.click(
        screen.getByRole('button', { name: 'Test connection' })
      )
      const dialog = screen.getByRole('dialog', {
        name: 'Connection test result',
      })
      expect(api.post).not.toHaveBeenCalled()
      expect(within(dialog).getByText('review-model')).toBeVisible()
      expect(dialog).not.toHaveTextContent('unsaved-key')
      expect(
        within(dialog).getByText(/"model_name": "review-model"/)
      ).toBeVisible()
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Test' })
      )
      await waitFor(() =>
        expect(api.post).toHaveBeenCalledExactlyOnceWith(
          '/api/option/ai_review/test',
          {
            base_url: 'https://review.example.com/v1',
            full_url_enabled: false,
            model_name: 'review-model',
            api_key: 'unsaved-key',
            custom_request_body: '',
            max_output_tokens: 2048,
            force_json_response: forceJSON,
          }
        )
      )
      expect(api.put).not.toHaveBeenCalled()
    }
  )

  it('opening the connection dialog sends no request until its test button is clicked', async () => {
    settings['ai_review_setting.enabled'] = true
    settings['ai_review_setting.base_url'] = 'https://review.example.com'
    settings['ai_review_setting.model_name'] = 'review-model'
    settings['ai_review_setting.api_key_configured'] = true
    const response = {
      data: {
        success: true,
        data: {
          request_url: 'https://review.example.com/v1/chat/completions',
          request_body: '{"model":"review-model"}',
          status_code: 200,
          content: 'Review endpoint ready',
          raw_response: '',
          error: '',
        },
      },
    }
    let completeRequest!: (value: typeof response) => void
    vi.mocked(api.post).mockReturnValueOnce(
      new Promise((resolve) => {
        completeRequest = resolve
      })
    )
    await renderPolicies('/system-settings/request-policies/ai-review')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Test connection' })
    )
    expect(
      screen.getByRole('dialog', { name: 'Connection test result' })
    ).toBeVisible()
    expect(api.post).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(screen.getByRole('status')).toHaveTextContent('Testing...')
    await act(async () => completeRequest(response))
    expect(await screen.findByText('Review endpoint ready')).toBeVisible()
    expect(screen.getByText('Connection succeeded')).toBeVisible()
  })

  it('a rejected connection test displays the failure in the result dialog', async () => {
    settings['ai_review_setting.enabled'] = true
    settings['ai_review_setting.base_url'] = 'https://review.example.com'
    settings['ai_review_setting.model_name'] = 'review-model'
    settings['ai_review_setting.api_key_configured'] = true
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Network unavailable'))
    await renderPolicies('/system-settings/request-policies/ai-review')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Test connection' })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(
      await screen.findByRole('dialog', { name: 'Connection test result' })
    ).toBeVisible()
    expect(screen.getByText('Connection failed')).toBeVisible()
    expect(screen.getByText('Network unavailable')).toBeVisible()
  })

  it('a rejected server response remains visible as raw data in the connection dialog', async () => {
    settings['ai_review_setting.enabled'] = true
    settings['ai_review_setting.base_url'] = 'https://review.example.com'
    settings['ai_review_setting.model_name'] = 'review-model'
    settings['ai_review_setting.api_key_configured'] = true
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        success: false,
        message: 'AI review response contains no content',
      },
    })
    await renderPolicies('/system-settings/request-policies/ai-review')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Test connection' })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText(/"success": false/)).toBeVisible()
    expect(screen.getByText('review-model')).toBeVisible()
    expect(
      screen.getByText(/"base_url": "https:\/\/review.example.com"/)
    ).toBeVisible()
  })

  it('the full URL switch is saved and sent with the connection test', async () => {
    settings['ai_review_setting.enabled'] = true
    await renderPolicies('/system-settings/request-policies/ai-review')
    fireEvent.change(
      await screen.findByRole('textbox', { name: 'API base URL' }),
      { target: { value: 'https://maas.example.com/v2/chat/completions' } }
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Review model' }), {
      target: { value: 'review-model' },
    })
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'unsaved-key' },
    })
    await userEvent.click(
      screen.getByRole('switch', { name: 'Use full request URL' })
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Test connection' })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Test' }))
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledExactlyOnceWith(
        '/api/option/ai_review/test',
        {
          base_url: 'https://maas.example.com/v2/chat/completions',
          full_url_enabled: true,
          model_name: 'review-model',
          api_key: 'unsaved-key',
          custom_request_body: '',
          max_output_tokens: 2048,
          force_json_response: true,
        }
      )
    )
    await userEvent.keyboard('{Escape}')
    await userEvent.click(
      screen.getByRole('button', { name: 'Save AI review settings' })
    )
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/option/', {
        key: 'ai_review_setting.full_url_enabled',
        value: 'true',
      })
    )
  })

  it('testing without a review model asks for one and sends no request', async () => {
    settings['ai_review_setting.enabled'] = true
    settings['ai_review_setting.base_url'] = 'https://review.example.com'
    settings['ai_review_setting.api_key_configured'] = true
    await renderPolicies('/system-settings/request-policies/ai-review')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Test connection' })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(api.post).not.toHaveBeenCalled()
  })

  it('refreshing options keeps unsaved AI review values and key', async () => {
    settings['ai_review_setting.enabled'] = true
    await renderPolicies('/system-settings/request-policies/ai-review')
    const model = await screen.findByRole('textbox', { name: 'Review model' })
    fireEvent.change(model, { target: { value: 'unsaved-model' } })
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'unsaved-key' },
    })
    settings['ai_review_setting.notify_admin_enabled'] = true
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['system-options'] })
    })
    expect(model).toHaveValue('unsaved-model')
    expect(screen.getByLabelText('API key')).toHaveValue('unsaved-key')
  })

  it('a rejected AI review save retains edits and can be retried', async () => {
    settings['ai_review_setting.enabled'] = true
    vi.mocked(api.put).mockResolvedValue({
      data: { success: false, message: 'Save rejected' },
    })
    await renderPolicies('/system-settings/request-policies/ai-review')
    const model = await screen.findByRole('textbox', { name: 'Review model' })
    fireEvent.change(model, { target: { value: 'retry-model' } })
    await userEvent.click(
      screen.getByRole('button', { name: 'Save AI review settings' })
    )
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1))
    expect(model).toHaveValue('retry-model')
    await userEvent.click(
      screen.getByRole('button', { name: 'Save AI review settings' })
    )
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2))
  })

  it.each([
    ['retry', 'Save Changes'],
    ['health', 'Save Changes'],
    ['filtering', 'Save sensitive words'],
    ['affinity', 'Save Changes'],
  ])(
    'opening %s and saving unchanged values does not write options',
    async (section, saveLabel) => {
      await renderPolicies(`/system-settings/request-policies/${section}`)
      const save = await screen.findByRole('button', { name: saveLabel })
      expect(api.put).not.toHaveBeenCalled()
      await userEvent.click(save)
      await waitFor(() => expect(save).toBeEnabled())
      expect(api.put).not.toHaveBeenCalled()
    }
  )

  it.each([
    [
      'health',
      'Channel test concurrency',
      '4',
      'monitor_setting.channel_test_concurrency',
      4,
    ],
  ])(
    'saving a changed %s field writes only that original option key',
    async (section, label, input, key, value) => {
      await renderPolicies(`/system-settings/request-policies/${section}`)
      fireEvent.change(await screen.findByRole('spinbutton', { name: label }), {
        target: { value: input },
      })
      await userEvent.click(
        screen.getByRole('button', { name: 'Save Changes' })
      )
      await waitFor(() =>
        expect(api.patch).toHaveBeenCalledExactlyOnceWith(
          '/api/option/request_policy',
          { options: { [key]: String(value) } }
        )
      )
    }
  )

  it('turning filtering off preserves the prompt switch and keyword list', async () => {
    await renderPolicies('/system-settings/request-policies/filtering')
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Enable filtering' })
    )
    const prompt = screen.getByRole('switch', { name: 'Inspect user prompts' })
    expect(prompt).toHaveAttribute('aria-disabled', 'true')
    expect(prompt).toBeChecked()
    expect(
      screen.getByRole('textbox', { name: 'Blocked keywords' })
    ).toHaveValue('blocked')
    await userEvent.click(
      screen.getByRole('button', { name: 'Save sensitive words' })
    )
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledExactlyOnceWith(
        '/api/option/request_policy',
        { options: { CheckSensitiveEnabled: 'false' } }
      )
    )
  })

  it('refreshing another policy keeps unsaved filter text', async () => {
    await renderPolicies('/system-settings/request-policies/filtering')
    const keywords = await screen.findByRole('textbox', {
      name: 'Blocked keywords',
    })
    fireEvent.change(keywords, { target: { value: 'unsaved' } })
    settings.RetryTimes = 5
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['system-options'] })
    })
    expect(keywords).toHaveValue('unsaved')
  })

  it('invalid retry status ranges show validation and do not write options', async () => {
    await renderPolicies('/system-settings/request-policies/retry')
    const codes = await screen.findByRole('textbox', {
      name: 'Auto-retry status codes',
    })
    expect(codes).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Advanced settings' })
    ).not.toBeInTheDocument()
    fireEvent.change(codes, { target: { value: '599-500' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(codes).toHaveAttribute('aria-invalid', 'true')
    expect(api.put).not.toHaveBeenCalled()
  })

  it('a rejected save keeps the edited retry value and allows another save', async () => {
    vi.mocked(api.patch).mockResolvedValue({
      data: { success: false, message: 'Save rejected' },
    })
    await renderPolicies('/system-settings/request-policies/retry')
    const retries = await screen.findByRole('spinbutton', {
      name: 'Maximum retries',
    })
    fireEvent.change(retries, { target: { value: '4' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
    )
    expect(retries).toHaveValue(4)
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2))
  })

  it('failed initial loading shows a retry action instead of editable fallback values', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Unavailable'))
    await renderPolicies('/system-settings/request-policies/retry')
    expect(await screen.findByText('Failed to load settings')).toBeVisible()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('spinbutton', {
        name: 'Maximum retries',
      })
    ).toHaveValue(2)
    expect(api.put).not.toHaveBeenCalled()
  })

  it('turning scheduled checks off explains recovery without changing the recovery setting', async () => {
    await renderPolicies('/system-settings/request-policies/health')
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Scheduled channel tests' })
    )
    expect(
      screen.getByText(
        'Scheduled recovery is off. Bulk channel tests can still re-enable automatically disabled channels.'
      )
    ).toBeVisible()
    expect(
      screen.getByRole('switch', { name: 'Re-enable on success' })
    ).toBeChecked()
    expect(api.put).not.toHaveBeenCalled()
  })

  it('the proxy pool section writes the changed interval option key', async () => {
    await renderPolicies('/system-settings/request-policies/proxy-pool')
    const interval = await screen.findByRole('spinbutton', {
      name: 'Check interval (minutes)',
    })
    expect(
      screen.getByRole('switch', { name: 'Scheduled proxy checks' })
    ).not.toBeChecked()
    expect(interval).toHaveValue(30)
    expect(interval).toBeDisabled()

    await userEvent.click(
      screen.getByRole('switch', { name: 'Scheduled proxy checks' })
    )
    expect(interval).toBeEnabled()
    fireEvent.change(interval, { target: { value: '5' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/option/', {
        key: 'proxy_pool_setting.auto_check_minutes',
        value: 5,
      })
    )
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'proxy_pool_setting.auto_check_enabled',
      value: true,
    })
  })

  it('an empty check address means a local check and is saved as empty', async () => {
    settings['proxy_pool_setting.check_url'] = 'https://example.com/echo'
    await renderPolicies('/system-settings/request-policies/proxy-pool')
    const address = await screen.findByRole('textbox', {
      name: 'Check address',
    })
    expect(address).toHaveValue('https://example.com/echo')

    fireEvent.change(address, { target: { value: '   ' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/option/', {
        key: 'proxy_pool_setting.check_url',
        value: '',
      })
    )
    expect(address).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('an invalid check address blocks saving the timeout', async () => {
    await renderPolicies('/system-settings/request-policies/proxy-pool')
    const address = await screen.findByRole('textbox', {
      name: 'Check address',
    })
    fireEvent.change(address, { target: { value: 'ftp://example.com' } })
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'Check timeout (seconds)' }),
      { target: { value: '20' } }
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(address).toHaveAttribute('aria-invalid', 'true')
    expect(api.put).not.toHaveBeenCalled()
  })

  it('the affinity cache section opens with the keyboard and keeps the existing values', async () => {
    await renderPolicies('/system-settings/request-policies/affinity')
    const toggle = await screen.findByRole('button', {
      name: 'Affinity cache settings',
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    toggle.focus()
    await userEvent.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('spinbutton', { name: 'Maximum cached sessions' })
    ).toHaveValue(100000)
    expect(
      screen.getByRole('spinbutton', {
        name: 'Default session lifetime (seconds)',
      })
    ).toHaveValue(3600)
    expect(api.put).not.toHaveBeenCalled()
  })

  it.each([
    ['/system-settings/models/channel-affinity', 'routing'],
    ['/system-settings/models/routing-reliability', 'routing'],
    ['/system-settings/security/sensitive-words', 'filtering'],
    ['/system-settings/operations/monitoring', 'health'],
    ['/system-settings/request-policies/', 'routing'],
    ['/system-settings/request-policies/unknown', 'routing'],
  ])('%s opens the corresponding policy page', async (path, section) => {
    const router = await renderPolicies(path)
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/system-settings/request-policies/${section}`
      )
    )
    expect(api.put).not.toHaveBeenCalled()
  })
})
