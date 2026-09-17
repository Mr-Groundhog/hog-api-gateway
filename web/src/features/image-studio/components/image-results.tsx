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
import { AlertCircle, Download, ImageIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardFooter } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

import { downloadImage } from '../lib/images'
import type { GeneratedImage, GenerationResult } from '../types'

interface ImageResultsProps {
  result: GenerationResult | null
  isGenerating: boolean
  elapsedSeconds: number
  error: Error | null
}

/** Generated output: in-flight skeletons, the images, or why nothing came back. */
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
    const placeholders = Array.from({ length: 2 }, (_, index) => index)
    return (
      <div className='space-y-4'>
        <div className='text-muted-foreground flex items-center gap-2 text-sm'>
          <Spinner data-icon='inline-start' />
          {t('Generating, elapsed {{seconds}}s', {
            seconds: props.elapsedSeconds,
          })}
        </div>
        <div className='grid gap-4 sm:grid-cols-2'>
          {placeholders.map((index) => (
            <Skeleton key={index} className='aspect-square w-full rounded-xl' />
          ))}
        </div>
      </div>
    )
  }

  if (props.error) {
    return (
      <Alert variant='destructive'>
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
        bordered
      />
    )
  }

  if (props.result.images.length === 0) {
    return (
      <Alert>
        <AlertCircle aria-hidden='true' />
        <AlertTitle>{t('No images returned')}</AlertTitle>
        <AlertDescription>
          {t('The model answered without any image. Try another model.')}
        </AlertDescription>
      </Alert>
    )
  }

  const result = props.result

  return (
    <div className='space-y-4'>
      <div className='grid gap-4 sm:grid-cols-2'>
        {result.images.map((image) => (
          <Card key={image.id} size='sm' className='gap-3 overflow-hidden'>
            <button
              type='button'
              className='bg-muted/40 block w-full cursor-zoom-in'
              onClick={() => setPreviewImage(image)}
              aria-label={t('Image preview')}
            >
              <img
                src={image.src}
                alt={result.prompt}
                loading='lazy'
                className='max-h-80 w-full object-contain'
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
        ))}
      </div>

      <Dialog
        open={previewImage !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewImage(null)
          }
        }}
        title={result.prompt}
        description={result.model}
        contentClassName='sm:max-w-3xl'
      >
        {previewImage ? (
          <img
            src={previewImage.src}
            alt={result.prompt}
            className='max-h-[70vh] w-full rounded-lg object-contain'
          />
        ) : null}
      </Dialog>
    </div>
  )
}
