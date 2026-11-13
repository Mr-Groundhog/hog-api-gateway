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
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { SignUpForm } from '../components/sign-up-form'

const checkCode = vi.fn<
  (code: string) => Promise<{
    data: { success: boolean; data?: { valid: boolean; reason?: string } }
  }>
>()
let client: QueryClient

function pendingCodeCheck() {
  type Response = Awaited<ReturnType<typeof checkCode>>
  let complete: (response: Response) => void = () => {
    throw new Error('Validation request is not initialized')
  }
  const promise = new Promise<Response>((resolve) => {
    complete = resolve
  })
  return { promise, resolve: (response: Response) => complete(response) }
}

async function renderSignUp(
  required = true,
  registrationEnabled = true,
  passwordRegistrationEnabled = true
) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(STATUS_QUERY_KEY, {
    register_enabled: registrationEnabled,
    password_register_enabled: passwordRegistrationEnabled,
    registration_code_enabled: required,
    github_oauth: true,
    github_client_id: 'github-client',
    discord_oauth: true,
    discord_client_id: 'discord-client',
    custom_oauth_providers: [
      {
        slug: 'custom',
        name: 'Custom',
        client_id: 'custom-client',
        authorization_endpoint: 'https://provider.example.com/authorize',
      },
    ],
  })
  const route = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <SignUpForm />
      </QueryClientProvider>
    ),
  })
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
  await screen.findByRole('button', { name: 'Create account' })
}

beforeEach(() => {
  localStorage.clear()
  checkCode.mockReset()
  checkCode.mockResolvedValue({
    data: { success: true, data: { valid: false, reason: 'invalid' } },
  })
  vi.spyOn(api, 'get').mockImplementation((url, config) => {
    if (url === '/api/user/registration-code/check') {
      const params = config?.params as { code?: string } | undefined
      return checkCode(params?.code ?? '')
    }
    return Promise.resolve({ data: { success: true, data: {} } })
  })
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: { flow_token: 'oauth-flow', expires_at: 4102444800 },
    },
  })
  vi.spyOn(window, 'open').mockReturnValue(null)
})

afterEach(() => {
  client?.clear()
  localStorage.clear()
})

describe('registration code gates account creation', () => {
  it('requires a code and disables account creation and every OAuth provider while empty', async () => {
    await renderSignUp()
    expect(
      screen.getByRole('textbox', { name: 'Registration code' })
    ).toBeRequired()
    expect(
      screen.getByRole('button', { name: 'Create account' })
    ).toBeDisabled()
    for (const name of ['GitHub', 'Discord', 'Custom']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    expect(checkCode).not.toHaveBeenCalled()
  })

  it.each([
    ['used', 'This registration code has been used'],
    ['expired', 'This registration code has expired'],
    ['invalid', 'Invalid registration code'],
  ])(
    'keeps every registration button disabled for a %s code',
    async (reason, message) => {
      checkCode.mockResolvedValue({
        data: { success: true, data: { valid: false, reason } },
      })
      await renderSignUp()
      const input = screen.getByRole('textbox', { name: 'Registration code' })
      await userEvent.type(input, 'invalid1')
      await screen.findByText(message)
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(
        screen.getByRole('button', { name: 'Create account' })
      ).toBeDisabled()
      expect(screen.getByRole('button', { name: 'GitHub' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Custom' })).toBeDisabled()
    }
  )

  it('disables buttons during validation and enables them only after success, carrying the verified code into OAuth', async () => {
    const pending = pendingCodeCheck()
    checkCode.mockReturnValue(pending.promise)
    await renderSignUp()
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Registration code' }),
      'valid123'
    )
    await waitFor(() => expect(checkCode).toHaveBeenCalledWith('valid123'))
    expect(
      screen.getByRole('button', { name: 'Create account' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'GitHub' })).toBeDisabled()
    await act(async () =>
      pending.resolve({ data: { success: true, data: { valid: true } } })
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create account' })
      ).toBeEnabled()
    )
    expect(screen.getByRole('button', { name: 'GitHub' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'GitHub' }))
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/api/oauth/state',
        expect.objectContaining({ registration_code: 'valid123' }),
        expect.anything()
      )
    )
    expect(window.open).toHaveBeenCalled()
  })

  it('immediately disables buttons when an accepted code changes, including during the debounce delay', async () => {
    checkCode.mockResolvedValueOnce({
      data: { success: true, data: { valid: true } },
    })
    await renderSignUp()
    const input = screen.getByRole('textbox', { name: 'Registration code' })
    await userEvent.type(input, 'valid123')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'GitHub' })).toBeEnabled()
    )
    fireEvent.change(input, { target: { value: 'invalid1' } })
    expect(screen.getByRole('button', { name: 'GitHub' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Create account' })
    ).toBeDisabled()
    await screen.findByText('Invalid registration code')
    expect(screen.getByRole('button', { name: 'GitHub' })).toBeDisabled()
    fireEvent.change(input, { target: { value: '' } })
    expect(
      screen.getByRole('button', { name: 'Create account' })
    ).toBeDisabled()
  })

  it('ignores a late successful response for a code that has been replaced', async () => {
    const stale = pendingCodeCheck()
    checkCode.mockReturnValueOnce(stale.promise)
    await renderSignUp()
    const input = screen.getByRole('textbox', { name: 'Registration code' })
    await userEvent.type(input, 'old12345')
    await waitFor(() => expect(checkCode).toHaveBeenCalledWith('old12345'))
    fireEvent.change(input, { target: { value: 'invalid1' } })
    await screen.findByText('Invalid registration code')
    await act(async () =>
      stale.resolve({ data: { success: true, data: { valid: true } } })
    )
    expect(
      screen.getByRole('button', { name: 'Create account' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'GitHub' })).toBeDisabled()
  })

  it.each(['network', 'business'])(
    'keeps buttons disabled when validation fails with a %s error',
    async (failure) => {
      if (failure === 'network') {
        checkCode.mockRejectedValue(new Error('offline'))
      } else {
        checkCode.mockResolvedValue({ data: { success: false } })
      }
      await renderSignUp()
      await userEvent.type(
        screen.getByRole('textbox', { name: 'Registration code' }),
        'valid123'
      )
      await screen.findByText(
        'Unable to validate registration code. Please try again.'
      )
      expect(
        screen.getByRole('button', { name: 'Create account' })
      ).toBeDisabled()
      expect(screen.getByRole('button', { name: 'GitHub' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Custom' })).toBeDisabled()
    }
  )

  it('blocks form submission while validation is pending even if the disabled button is bypassed', async () => {
    checkCode.mockReturnValue(new Promise(() => {}))
    await renderSignUp()
    const user = userEvent.setup()
    await user.type(
      screen.getByRole('textbox', { name: 'Username' }),
      'test-user'
    )
    await user.type(
      screen.getByLabelText('Password', { exact: true }),
      'Registration-password-123'
    )
    await user.type(
      screen.getByLabelText('Confirm password', { exact: true }),
      'Registration-password-123'
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Registration code' }),
      'valid123'
    )
    const form = screen
      .getByRole('button', { name: 'Create account' })
      .closest('form')
    if (!form) throw new Error('Registration form is missing')
    fireEvent.submit(form)
    await act(async () => {})
    expect(api.post).not.toHaveBeenCalled()
  })

  it('does not require or check a code when the feature is disabled', async () => {
    await renderSignUp(false)
    expect(
      screen.queryByRole('textbox', { name: 'Registration code' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'GitHub' })).toBeEnabled()
    expect(checkCode).not.toHaveBeenCalled()
  })

  it('disables all creation buttons when registration is closed without requiring a code', async () => {
    await renderSignUp(false, false)
    expect(
      screen.getByText(
        'New user registration has been disabled by administrator'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Create account' })
    ).toBeDisabled()
    for (const name of ['GitHub', 'Discord', 'Custom']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    const user = userEvent.setup()
    await user.type(
      screen.getByRole('textbox', { name: 'Username' }),
      'test-user'
    )
    await user.type(
      screen.getByLabelText('Password', { exact: true }),
      'Registration-password-123'
    )
    await user.type(
      screen.getByLabelText('Confirm password', { exact: true }),
      'Registration-password-123'
    )
    const form = screen
      .getByRole('button', { name: 'Create account' })
      .closest('form')
    if (!form) throw new Error('Registration form is missing')
    fireEvent.submit(form)
    await act(async () => {})
    expect(api.post).not.toHaveBeenCalled()
    expect(checkCode).not.toHaveBeenCalled()
  })

  it('keeps OAuth available when only password registration is disabled', async () => {
    await renderSignUp(false, true, false)
    expect(
      screen.getByRole('button', { name: 'Create account' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'GitHub' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Custom' })).toBeEnabled()
  })
})
