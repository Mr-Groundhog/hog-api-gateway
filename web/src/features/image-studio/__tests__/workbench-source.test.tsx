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
import { fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { describe, expect, test, vi } from 'vitest'

import {
  ImagePromptForm,
  type ImagePromptFormProps,
} from '../components/image-prompt-form'
import { IMAGE_KEY_SOURCES } from '../constants'
import { DEFAULT_CONFIG, DEFAULT_CUSTOM_ENDPOINT } from '../lib/storage'

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

const KEY = {
  id: 1,
  name: 'Default key',
  group: 'default',
  remainQuota: 5000,
  unlimitedQuota: false,
}

function renderForm(overrides: Partial<ImagePromptFormProps> = {}) {
  const props: ImagePromptFormProps = {
    keys: [KEY],
    selectedKey: KEY,
    onSelectKey: vi.fn(),
    models: [{ value: 'gpt-image-1', label: 'gpt-image-1' }],
    isAdminConfigured: true,
    keySource: IMAGE_KEY_SOURCES.SYSTEM,
    onKeySourceChange: vi.fn(),
    customEndpoint: DEFAULT_CUSTOM_ENDPOINT,
    onCustomEndpointChange: vi.fn(),
    onRefreshModels: vi.fn(),
    isRefreshingModels: false,
    modelsError: null,
    config: { ...DEFAULT_CONFIG, model: 'gpt-image-1' },
    onConfigChange: vi.fn(),
    prompt: 'a cat',
    onPromptChange: vi.fn(),
    isGenerating: false,
    canGenerate: true,
    onGenerate: vi.fn(),
    onCancel: vi.fn(),
    usage: { used: 1, limit: 10, remaining: 9, unlimited: false },
    isUsageLoading: false,
    ...overrides,
  }

  render(
    <I18nextProvider i18n={i18n}>
      <ImagePromptForm {...props} />
    </I18nextProvider>
  )

  return props
}

describe('workbench key source', () => {
  test('shows the site key picker and the daily quota for the system source', () => {
    renderForm()

    expect(screen.getByLabelText('API Key')).toBeInTheDocument()
    expect(screen.getByText('Remaining: 9')).toBeInTheDocument()

    // Nothing about the user's own endpoint belongs on this side of the switch.
    expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/never uploaded to the server/)
    ).not.toBeInTheDocument()
  })

  test('requests the custom source when its toggle is pressed', () => {
    const props = renderForm()

    fireEvent.click(screen.getByRole('button', { name: 'Custom key' }))

    expect(props.onKeySourceChange).toHaveBeenCalledWith(
      IMAGE_KEY_SOURCES.CUSTOM
    )
  })

  test('shows the endpoint fields, the local-only notice and no quota for the custom source', () => {
    renderForm({ keySource: IMAGE_KEY_SOURCES.CUSTOM })

    expect(screen.getByLabelText('Base URL')).toBeInTheDocument()
    expect(screen.getByLabelText('API Key')).toBeInTheDocument()
    expect(
      screen.getByText(
        'A custom key is kept in this browser only and is never uploaded to the server.'
      )
    ).toBeInTheDocument()

    // The daily limit is a property of this site's keys, so it is not claimed
    // for generations this site never sees.
    expect(screen.queryByText('Remaining: 9')).not.toBeInTheDocument()
  })

  test('reports an address a browser could not call', () => {
    renderForm({
      keySource: IMAGE_KEY_SOURCES.CUSTOM,
      customEndpoint: { baseUrl: 'api.example.com', apiKey: 'sk-custom' },
    })

    expect(screen.getByLabelText('Base URL')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
  })

  test('keeps the refresh button disabled until the endpoint is complete', () => {
    const props = renderForm({ keySource: IMAGE_KEY_SOURCES.CUSTOM })

    const refresh = screen.getByRole('button', { name: 'Refresh models' })
    expect(refresh).toBeDisabled()

    fireEvent.click(refresh)
    expect(props.onRefreshModels).not.toHaveBeenCalled()
  })

  test('reloads the model list from the endpoint when refresh is pressed', () => {
    const props = renderForm({
      keySource: IMAGE_KEY_SOURCES.CUSTOM,
      customEndpoint: {
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-custom',
      },
    })

    const refresh = screen.getByRole('button', { name: 'Refresh models' })
    expect(refresh).toBeEnabled()

    fireEvent.click(refresh)
    expect(props.onRefreshModels).toHaveBeenCalledTimes(1)
  })

  test('surfaces a failed model list instead of the empty dropdown hint', () => {
    renderForm({
      keySource: IMAGE_KEY_SOURCES.CUSTOM,
      customEndpoint: {
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-custom',
      },
      models: [],
      modelsError: 'Could not reach the endpoint.',
    })

    expect(
      screen.getByText('Could not reach the endpoint.')
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/then refresh to load the models/)
    ).not.toBeInTheDocument()
  })
})

describe('workbench parameters', () => {
  test('leaves the size out for a model that derives it from the pair', () => {
    // The pixels follow from the ratio and the resolution, so the panel must
    // not offer a number the user would then try to reconcile.
    renderForm({
      config: {
        ...DEFAULT_CONFIG,
        model: 'gpt-image-2',
        ratio: '16:9',
        resolution: '2K',
        size: '2048x1152',
      },
    })

    expect(screen.queryByLabelText('Size')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Aspect ratio')).toBeInTheDocument()
    expect(screen.getByLabelText('Resolution')).toBeInTheDocument()
  })

  test('keeps the size picker for a model with a fixed size list', () => {
    renderForm({ config: { ...DEFAULT_CONFIG, model: 'gpt-image-1' } })

    expect(screen.getByLabelText('Size')).toBeInTheDocument()
  })
})
