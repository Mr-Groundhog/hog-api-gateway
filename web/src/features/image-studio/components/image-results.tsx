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
import { AlertCircle, Download, ImageIcon, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Shimmer } from '@/components/ai-elements/shimmer'
import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardFooter } from '@/components/ui/card'

import { downloadImage } from '../lib/images'
import type { GeneratedImage, GenerationResult } from '../types'

interface ImageResultsProps {
  result: GenerationResult | null
  isGenerating: boolean
  elapsedSeconds: number
  /** Shown inside the generating placeholder, so the wait has context. */
  pendingPrompt: string
  error: Error | null
}

/**
 * The in-flight placeholder.
 *
 * A single card matching the size of the image that will replace it, with a
 * slow highlight sweeping across and the prompt still visible — cheaper on the
 * eye than a pair of grey blocks, and it keeps the user oriented while a slow
 * upstream (several Wanxiang models poll server-side) takes its time.
 */
function GeneratingPlaceholder(props: {
  prompt: string
  elapsedSeconds: number
}) {
  const { t } = useTranslation()

  return (
    <div className='border-border/60 bg-muted/20 relative flex min-h-[300px] w-full items-center justify-center overflow-hidden rounded-xl border lg:aspect-auto lg:h-full'>
      <motion.div
        aria-hidden='true'
        className='via-primary/10 absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent to-transparent'
        initial={{ x: '-100%' }}
        animate={{ x: '200%' }}
        transition={{
          repeat: Number.POSITIVE_INFINITY,
          duration: 2.4,
          ease: 'linear',
        }}
      />

      <div className='relative flex max-w-sm flex-col items-center gap-3 px-6 text-center'>
        <motion.div
          animate={{ scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }}
          transition={{
            repeat: Number.POSITIVE_INFINITY,
            duration: 2.4,
            ease: 'easeInOut',
          }}
          className='bg-primary/10 text-primary flex size-11 items-center justify-center rounded-full'
        >
          <Sparkles aria-hidden='true' className='size-5' />
        </motion.div>

        <Shimmer className='text-sm font-medium'>
          {t('Generating, elapsed {{seconds}}s', {
            seconds: props.elapsedSeconds,
          })}
        </Shimmer>

        {props.prompt ? (
          <p className='text-muted-foreground line-clamp-3 text-xs'>
            {props.prompt}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** Generated output: the in-flight placeholder, the image, or why nothing came back. */
export function ImageResults(props: ImageResultsProps) {
  const { t } = useTranslation()
  const [previewImage, setPreviewImage] = useState<GeneratedImage | null>(null)

  const handleDownload = (image: GeneratedImage) => {
    downloadImage(image).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('Failed to download image:', error)
      toast.error(t('Failed to download image'))
    })
  }

  if (props.isGenerating) {
    return (
      <GeneratingPlaceholder
        prompt={props.pendingPrompt}
        elapsedSeconds={props.elapsedSeconds}
      />
    )
  }

  if (props.error) {
    return (
      <Alert className='h-full' variant='destructive'>
        <AlertCircle aria-hidden='true' />
        <AlertTitle>{t('Failed to generate image')}</AlertTitle>
        <AlertDescription>{props.error.message}</AlertDescription>
      </Alert>
    )
  }

  if (!props.result) {
    return (
      <EmptyState
        icon={ImageIcon}
        title={t('Nothing generated yet')}
        description={t('Write a prompt and generate to see images here.')}
        fill
        bordered
      />
    )
  }

  const result = props.result

  if (result.images.length === 0) {
    return (
      <Alert className='h-full'>
        <AlertCircle aria-hidden='true' />
        <AlertTitle>{t('No images returned')}</AlertTitle>
        <AlertDescription>
          {t('The model answered without any image. Try another model.')}
        </AlertDescription>
      </Alert>
    )
  }

  const image = result.images[0]

  return (
    <div className='h-full space-y-4'>
      <Card size='sm' className='gap-3 overflow-hidden lg:h-full'>
        <button
          type='button'
          className='bg-muted/40 block min-h-0 w-full flex-1 cursor-zoom-in'
          onClick={() => setPreviewImage(image)}
          aria-label={t('Image preview')}
        >
          <img
            src={image.src}
            alt={result.prompt}
            className='h-full max-h-[32rem] min-h-0 w-full object-contain lg:max-h-full'
          />
        </button>
        <CardFooter className='gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => handleDownload(image)}
          >
            <Download aria-hidden='true' className='size-4' />
            {t('Download')}
          </Button>
          <CopyButton
            value={result.prompt}
            variant='ghost'
            size='sm'
            tooltip={t('Copy prompt')}
            successTooltip={t('Prompt copied')}
            aria-label={t('Copy prompt')}
          />
        </CardFooter>
      </Card>

      <Dialog
        open={previewImage !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewImage(null)
          }
        }}
        title={t('Image preview')}
        description={result.model}
        contentClassName='sm:max-w-3xl'
      >
        {previewImage ? (
          <div className='space-y-3'>
            <img
              src={previewImage.src}
              alt={result.prompt}
              className='max-h-[60vh] w-full rounded-lg object-contain'
            />
            <div className='bg-muted/40 flex items-start gap-2 rounded-lg border p-3'>
              <p className='min-w-0 flex-1 text-sm break-words whitespace-pre-wrap'>
                {result.prompt}
              </p>
              <CopyButton
                value={result.prompt}
                variant='ghost'
                size='sm'
                className='shrink-0'
                tooltip={t('Copy prompt')}
                successTooltip={t('Prompt copied')}
                aria-label={t('Copy prompt')}
              />
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}
