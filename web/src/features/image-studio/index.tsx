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
import { Link } from '@tanstack/react-router'
import { Images, KeyRound, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { GalleryView } from './components/gallery-view'
import { ImagePromptForm } from './components/image-prompt-form'
import { ImageResults } from './components/image-results'
import { STUDIO_VIEWS, STORAGE_KEYS, type StudioView } from './constants'
import { useGallery } from './hooks/use-gallery'
import { useImageGeneration } from './hooks/use-image-generation'
import { useImageApiKey } from './hooks/use-image-key'
import { useImageModels } from './hooks/use-image-models'
import { useImageStudioUsage } from './hooks/use-image-studio-usage'
import { normalizeConfigForModel } from './lib/model-capabilities'
import { loadConfig, saveConfig } from './lib/storage'
import type { GenerationResult, ImageStudioConfig } from './types'

function loadView(): StudioView {
  try {
    return localStorage.getItem(STORAGE_KEYS.VIEW) === STUDIO_VIEWS.GALLERY
      ? STUDIO_VIEWS.GALLERY
      : STUDIO_VIEWS.WORKBENCH
  } catch {
    return STUDIO_VIEWS.WORKBENCH
  }
}

/**
 * 生图工作台：用用户自己的密钥做文生图，并把结果留在本地画廊。
 *
 * 不走 Playground 的会话计费通道，而是取用户创建的 API 密钥直接调用中继，
 * 因此扣减的是密钥额度与钱包余额；密钥自身的分组、模型限制与 IP 白名单同样生效。
 */
export function ImageStudio() {
  const { t } = useTranslation()
  const [view, setView] = useState<StudioView>(loadView)
  // Normalise on load so every advanced control starts with a value its own
  // dropdown offers, even before a model has been picked.
  const [config, setConfig] = useState<ImageStudioConfig>(() => {
    const stored = loadConfig()
    return normalizeConfigForModel(stored, stored.model)
  })
  const [prompt, setPrompt] = useState('')
  const [submittedPrompt, setSubmittedPrompt] = useState('')
  const { keys, selectedKey, selectKey, apiKey, isLoading, error } =
    useImageApiKey()
  const { models, isAdminConfigured } = useImageModels(
    selectedKey?.group ?? '',
    config.showAllModels
  )
  const usage = useImageStudioUsage()
  const generation = useImageGeneration(() => {
    void usage.refetch()
  })
  const gallery = useGallery()

  const updateView = useCallback((next: string) => {
    const resolved =
      next === STUDIO_VIEWS.GALLERY
        ? STUDIO_VIEWS.GALLERY
        : STUDIO_VIEWS.WORKBENCH
    setView(resolved)
    try {
      localStorage.setItem(STORAGE_KEYS.VIEW, resolved)
    } catch (cause) {
      // eslint-disable-next-line no-console
      console.error('Failed to persist the image studio view:', cause)
    }
  }, [])

  const updateConfig = useCallback((patch: Partial<ImageStudioConfig>) => {
    setConfig((previous) => {
      const merged = { ...previous, ...patch }
      // A new model invalidates size/quality/format it cannot honour.
      const next =
        patch.model === undefined
          ? merged
          : normalizeConfigForModel(merged, merged.model)
      saveConfig(next)
      return next
    })
  }, [])

  // Keep the selection pointing at something the current list actually offers.
  useEffect(() => {
    if (models.length === 0) {
      return
    }
    if (models.some((option) => option.value === config.model)) {
      return
    }
    const fallback = models[0]?.value ?? ''
    if (fallback !== config.model) {
      updateConfig({ model: fallback })
    }
  }, [models, config.model, updateConfig])

  // File each successful generation into the gallery exactly once.
  const archivedResult = useRef<GenerationResult | null>(null)
  useEffect(() => {
    const result = generation.result
    if (!result || result === archivedResult.current) {
      return
    }
    archivedResult.current = result
    void gallery.save(result)
  }, [generation.result, gallery])

  const canGenerate =
    Boolean(apiKey) &&
    Boolean(config.model) &&
    prompt.trim().length > 0 &&
    (usage.data === undefined ||
      usage.data.unlimited ||
      usage.data.remaining > 0) &&
    !generation.isGenerating

  const handleGenerate = useCallback(() => {
    if (!canGenerate) {
      return
    }
    setSubmittedPrompt(prompt.trim())
    generation.generate({
      apiKey,
      model: config.model,
      prompt: prompt.trim(),
      size: config.size,
      ratio: config.ratio,
      resolution: config.resolution,
      quality: config.quality,
      format: config.format,
    })
  }, [apiKey, canGenerate, config, generation, prompt])

  const title = (
    <span className='inline-flex items-center gap-2'>
      <Wand2 aria-hidden='true' className='size-5' />
      {t('Image Studio')}
    </span>
  )

  if (isLoading) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>{title}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <LoadingState message={t('Loading API keys...')} />
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  if (error) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>{title}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <ErrorState
            title={t('Failed to load API keys')}
            description={error.message}
          />
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{title}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <Tabs value={view} onValueChange={updateView} className='gap-6'>
          <div className='flex justify-center'>
            <TabsList className='grid w-full max-w-sm grid-cols-2'>
              <TabsTrigger value={STUDIO_VIEWS.WORKBENCH} className='gap-1.5'>
                <Wand2 aria-hidden='true' className='size-4' />
                {t('Workbench')}
              </TabsTrigger>
              <TabsTrigger value={STUDIO_VIEWS.GALLERY} className='gap-1.5'>
                <Images aria-hidden='true' className='size-4' />
                {t('Gallery')}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value={STUDIO_VIEWS.WORKBENCH}>
            {keys.length === 0 ? (
              <EmptyState
                icon={KeyRound}
                title={t('No enabled API key')}
                description={t(
                  'Create an API key first — generations are billed to it.'
                )}
                action={
                  <Button nativeButton={false} render={<Link to='/keys' />}>
                    {t('Go to API Keys')}
                  </Button>
                }
                bordered
              />
            ) : (
              /* The form alone decides the row height on desktop: the preview
                 pane is taken out of flow and fills exactly that height, so a
                 tall image can never stretch the row. Below lg the panes stack. */
              <div className='grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]'>
                <ImagePromptForm
                  keys={keys}
                  selectedKey={selectedKey}
                  onSelectKey={selectKey}
                  models={models}
                  isAdminConfigured={isAdminConfigured}
                  config={config}
                  onConfigChange={updateConfig}
                  prompt={prompt}
                  onPromptChange={setPrompt}
                  isGenerating={generation.isGenerating}
                  canGenerate={canGenerate}
                  onGenerate={handleGenerate}
                  onCancel={generation.cancel}
                  usage={usage.data}
                  isUsageLoading={usage.isLoading}
                />
                <div className='relative min-w-0'>
                  <div className='lg:absolute lg:inset-0'>
                    <ImageResults
                      result={generation.result}
                      isGenerating={generation.isGenerating}
                      elapsedSeconds={generation.elapsedSeconds}
                      pendingPrompt={submittedPrompt}
                      error={generation.error}
                    />
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value={STUDIO_VIEWS.GALLERY}>
            <GalleryView store={gallery} />
          </TabsContent>
        </Tabs>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
