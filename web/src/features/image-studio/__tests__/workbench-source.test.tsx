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

function formProps(
  overrides: Partial<ImagePromptFormProps> = {}
): ImagePromptFormProps {
  return {
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
}

function renderForm(overrides: Partial<ImagePromptFormProps> = {}) {
  const props = formProps(overrides)

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
  test('never asks for a size, for any model', () => {
    // The pixels follow from the ratio and the resolution, so the panel must
    // not offer a number the user would then try to reconcile — not even for a
    // model that only draws a few fixed shapes.
    for (const model of ['gpt-image-2', 'gpt-image-1', 'dall-e-3', 'image-01']) {
      const { unmount } = render(
        <I18nextProvider i18n={i18n}>
          <ImagePromptForm
            {...formProps({ config: { ...DEFAULT_CONFIG, model } })}
          />
        </I18nextProvider>
      )

      expect(screen.queryByLabelText('Size')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Aspect ratio')).toBeInTheDocument()
      unmount()
    }
  })

  test('shows the resolution only when the model has more than one to offer', () => {
    // GPT Image 2 offers tiers per ratio, so the control is real…
    renderForm({ config: { ...DEFAULT_CONFIG, model: 'gpt-image-2' } })
    expect(screen.getByLabelText('Resolution')).toBeInTheDocument()
  })

  test('drops the resolution for a model with one size per shape', () => {
    // …while GPT Image 1 draws one size per shape: nothing to choose.
    renderForm({ config: { ...DEFAULT_CONFIG, model: 'gpt-image-1' } })
    expect(screen.queryByLabelText('Resolution')).not.toBeInTheDocument()
  })

  test('leaves out a control that has a single answer', () => {
    // DALL·E 2 draws squares only, so the ratio cannot vary; its three official
    // sizes are what the resolution offers.
    renderForm({ config: { ...DEFAULT_CONFIG, model: 'dall-e-2' } })

    expect(screen.queryByLabelText('Size')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Aspect ratio')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Resolution')).toBeInTheDocument()
  })
})
