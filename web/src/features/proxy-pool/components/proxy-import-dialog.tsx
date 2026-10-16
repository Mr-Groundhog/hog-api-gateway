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
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { handleServerError } from '@/lib/handle-server-error'
import { translateServerText } from '@/lib/server-error-message'

import { importProxies } from '../api'
import { PROXY_IMPORT_LIMITS } from '../constants'
import { proxyPoolQueryKeys } from '../lib/proxy-pool-actions'
import type { ProxyImportResult } from '../types'

interface ProxyImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProxyImportDialog(props: ProxyImportDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [content, setContent] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [isImporting, setIsImporting] = useState(false)
  const [result, setResult] = useState<ProxyImportResult | null>(null)

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > PROXY_IMPORT_LIMITS.maxBytes) {
      toast.error(t('The imported file is too large'))
      return
    }
    const text = await file.text()
    setContent(text)
    setResult(null)
  }

  const handleImport = async () => {
    if (!content.trim()) {
      toast.error(t('Please paste or upload the proxy list first'))
      return
    }
    setIsImporting(true)
    try {
      const response = await importProxies(content, enabled)
      if (!response.success || !response.data) {
        handleServerError(response, t('Import failed'))
        return
      }
      setResult(response.data)
      toast.success(
        t('Imported {{added}} proxy(ies)', { added: response.data.added })
      )
      queryClient.invalidateQueries({ queryKey: proxyPoolQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: proxyPoolQueryKeys.summary() })
    } catch (error) {
      handleServerError(error, t('Import failed'))
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open)
        if (!open) {
          setResult(null)
          setContent('')
        }
      }}
      title={t('Import Proxies')}
      description={t(
        'One proxy per line. Empty lines and lines starting with # are ignored; duplicates and invalid lines are skipped.'
      )}
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={isImporting}
          >
            {t('Close')}
          </Button>
          <Button onClick={handleImport} disabled={isImporting}>
            {isImporting && (
              <Loader2 className='animate-spin' aria-hidden='true' />
            )}
            {t('Import')}
          </Button>
        </>
      }
    >
      <div className='space-y-3'>
        <div className='flex flex-wrap items-center gap-2'>
          <input
            ref={fileInputRef}
            type='file'
            accept='.txt,text/plain'
            className='sr-only'
            aria-label={t('Import from TXT file')}
            onChange={(event) => {
              void handleFile(event.target.files?.[0])
              event.target.value = ''
            }}
          />
          <Button
            variant='outline'
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
          >
            <Upload aria-hidden='true' />
            {t('Import from TXT file')}
          </Button>
          <div className='flex items-center gap-2'>
            <Switch
              id='proxy-import-enabled'
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label={t('Enable imported proxies')}
            />
            <Label htmlFor='proxy-import-enabled'>
              {t('Enable imported proxies')}
            </Label>
          </div>
        </div>
        <textarea
          className='border-input focus-visible:border-ring focus-visible:ring-ring/50 h-56 w-full rounded-md border bg-transparent p-3 font-mono text-xs shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-3'
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={t(
            'Paste one proxy per line, for example socks5://user:pass@host:1080'
          )}
          aria-label={t('Proxy list')}
          spellCheck={false}
        />
        {result ? (
          <div className='space-y-2 rounded-md border p-3 text-xs'>
            <p>{t('Added: {{added}}', { added: result.added })}</p>
            <p>
              {t('Duplicated and skipped: {{duplicated}}', {
                duplicated: result.duplicated,
              })}
            </p>
            <p>{t('Invalid: {{invalid}}', { invalid: result.invalid })}</p>
            {result.invalid_lines.length > 0 ? (
              <div className='text-muted-foreground max-h-32 space-y-1 overflow-y-auto'>
                {result.invalid_lines.map((line) => (
                  <p key={line.line} className='font-mono break-all'>
                    {t('Line {{line}}', { line: line.line })}: {line.preview} —{' '}
                    {translateServerText(t, line.reason)}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
