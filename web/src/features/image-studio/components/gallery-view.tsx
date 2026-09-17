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
import dayjs from 'dayjs'
import { Clock, Download, ImageOff, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardFooter } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import { GALLERY_RETENTION_DAYS } from '../constants'
import type { GalleryStore } from '../hooks/use-gallery'
import { downloadImage } from '../lib/images'
import type { GalleryRecord } from '../types'

/** One stored generation, with a graceful fallback for a dead remote URL. */
function GalleryCard(props: {
  record: GalleryRecord
  onPreview: (record: GalleryRecord) => void
  onDelete: (record: GalleryRecord) => void
  onDownload: (record: GalleryRecord) => void
}) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)

  return (
    <Card size='sm' className='gap-2 overflow-hidden py-0'>
      <button
        type='button'
        className='bg-muted/40 block w-full cursor-zoom-in'
        onClick={() => props.onPreview(props.record)}
        aria-label={t('Image preview')}
      >
        {/*
          The ratio lives on a wrapper, not on the <img>: a replaced element
          keeps its intrinsic ratio when its height is auto, which let portrait
          generations stretch a tile far past the grid's row height.
        */}
        <div className='relative aspect-[4/3] w-full overflow-hidden'>
          {failed ? (
            <div className='text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3 text-center text-xs'>
              <ImageOff aria-hidden='true' className='size-5' />
              {t('Image expired or unavailable')}
            </div>
          ) : (
            <img
              src={props.record.src}
              alt={props.record.prompt}
              loading='lazy'
              className='absolute inset-0 size-full object-cover'
              onError={() => setFailed(true)}
            />
          )}
        </div>
      </button>
      <div className='min-w-0 space-y-0.5 px-2'>
        <p className='truncate text-xs' title={props.record.prompt}>
          {props.record.prompt}
        </p>
        <p className='text-muted-foreground truncate text-[11px]'>
          {props.record.model}
          {' · '}
          <span className='tabular-nums'>
            {dayjs(props.record.createdAt).format('MM-DD HH:mm')}
          </span>
        </p>
      </div>
      <CardFooter className='gap-0.5 px-1.5 pb-2'>
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          onClick={() => props.onDownload(props.record)}
          disabled={failed}
          aria-label={t('Download')}
          title={t('Download')}
        >
          <Download aria-hidden='true' className='size-4' />
        </Button>
        <CopyButton
          value={props.record.prompt}
          variant='ghost'
          size='icon'
          tooltip={t('Copy prompt')}
          successTooltip={t('Prompt copied')}
          aria-label={t('Copy prompt')}
        />
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          className='text-muted-foreground hover:text-destructive ml-auto'
          onClick={() => props.onDelete(props.record)}
          aria-label={t('Delete')}
          title={t('Delete')}
        >
          <Trash2 aria-hidden='true' className='size-4' />
        </Button>
      </CardFooter>
    </Card>
  )
}

/**
 * The gallery view: generations made in this browser, newest first.
 *
 * The images never reach the server, so this browser is the only copy — which
 * is exactly why the retention notice tells the user to save what matters.
 */
export function GalleryView(props: { store: GalleryStore }) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<GalleryRecord | null>(null)
  const [pendingDelete, setPendingDelete] = useState<GalleryRecord | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const downloadRecord = useCallback(
    (record: GalleryRecord) => {
      downloadImage({
        id: record.id,
        src: record.src,
        fileName: record.fileName,
      }).catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.error('Failed to download image:', error)
        toast.error(t('Failed to download image'))
      })
    },
    [t]
  )

  if (props.store.isLoading) {
    return (
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className='aspect-square w-full rounded-xl' />
        ))}
      </div>
    )
  }

  if (props.store.error) {
    return (
      <Alert variant='destructive'>
        <AlertTitle>{t('Failed to load the gallery')}</AlertTitle>
        <AlertDescription>
          {t('Your browser blocked local storage for this site.')}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className='space-y-4'>
      <Alert>
        <Clock aria-hidden='true' />
        <AlertTitle>
          {t('Generation history is kept for {{days}} days', {
            days: GALLERY_RETENTION_DAYS,
          })}
        </AlertTitle>
        <AlertDescription>
          {t(
            'Images are stored in this browser only. Save the ones you need before they are removed.'
          )}
        </AlertDescription>
      </Alert>

      {props.store.entries.length === 0 ? (
        <EmptyState
          title={t('Nothing in the gallery yet')}
          description={t('Generated images appear here for a few days.')}
          bordered
        />
      ) : (
        <>
          <div className='flex justify-end'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => setConfirmClear(true)}
            >
              <Trash2 aria-hidden='true' className='size-4' />
              {t('Clear gallery')}
            </Button>
          </div>
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
            {props.store.entries.map((record) => (
              <GalleryCard
                key={record.id}
                record={record}
                onPreview={setPreview}
                onDelete={setPendingDelete}
                onDownload={downloadRecord}
              />
            ))}
          </div>
        </>
      )}

      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreview(null)
          }
        }}
        title={t('Image preview')}
        description={
          preview
            ? `${preview.model} · ${dayjs(preview.createdAt).format('MM-DD HH:mm')}`
            : undefined
        }
        contentClassName='sm:max-w-3xl'
        footer={
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => {
              if (preview) {
                downloadRecord(preview)
              }
            }}
          >
            <Download aria-hidden='true' className='size-4' />
            {t('Download')}
          </Button>
        }
      >
        {preview ? (
          <div className='space-y-3'>
            <img
              src={preview.src}
              alt={preview.prompt}
              className='max-h-[60vh] w-full rounded-lg object-contain'
            />
            <div className='bg-muted/40 flex items-start gap-2 rounded-lg border p-3'>
              <p className='min-w-0 flex-1 text-sm break-words whitespace-pre-wrap'>
                {preview.prompt}
              </p>
              <CopyButton
                value={preview.prompt}
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

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null)
          }
        }}
        title={t('Delete this image?')}
        desc={t(
          'It is removed from this browser only. The original generation started from a remote address cannot be recovered.'
        )}
        confirmText={t('Delete')}
        destructive
        handleConfirm={() => {
          const record = pendingDelete
          setPendingDelete(null)
          if (record) {
            void props.store.remove(record.id)
          }
        }}
      />

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t('Clear the gallery?')}
        desc={t('Every stored image in this browser will be deleted.')}
        confirmText={t('Clear gallery')}
        destructive
        handleConfirm={() => {
          setConfirmClear(false)
          void props.store.clear()
        }}
      />
    </div>
  )
}
