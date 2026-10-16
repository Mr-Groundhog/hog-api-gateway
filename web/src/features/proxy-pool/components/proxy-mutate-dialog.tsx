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
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { handleServerError } from '@/lib/handle-server-error'

import { createProxy, testProxies, updateProxy } from '../api'
import { proxyPoolQueryKeys } from '../lib/proxy-pool-actions'
import { proxyUrlSchema, type ProxyEntry } from '../types'

interface ProxyMutateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null 表示新增，否则为编辑目标。 */
  proxy: ProxyEntry | null
}

export function ProxyMutateDialog(props: ProxyMutateDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isEdit = props.proxy !== null
  const [url, setUrl] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [urlError, setUrlError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)

  useEffect(() => {
    if (!props.open) return
    setUrl('')
    setEnabled(props.proxy?.enabled ?? true)
    setUrlError('')
  }, [props.open, props.proxy])

  const validateUrl = (value: string, required: boolean): boolean => {
    if (!value.trim()) {
      setUrlError(required ? t('Proxy address is required') : '')
      return !required
    }
    if (!proxyUrlSchema.safeParse(value).success) {
      setUrlError(
        t(
          'Invalid proxy URL: it must use http, https, socks5, or socks5h and include a host'
        )
      )
      return false
    }
    setUrlError('')
    return true
  }

  const handleTest = async () => {
    if (!validateUrl(url, true)) return
    setIsTesting(true)
    try {
      const response = await testProxies({ url: url.trim() })
      const result = response.data?.results?.[0]
      if (!response.success || !result) {
        handleServerError(response, t('Proxy test failed'))
        return
      }
      if (result.ok) {
        toast.success(
          result.exit_ip
            ? t('Proxy is reachable, exit IP {{ip}}, {{latency}} ms', {
                ip: result.exit_ip,
                latency: result.latency_ms,
              })
            : t('Proxy is reachable, {{latency}} ms', {
                latency: result.latency_ms,
              })
        )
      } else {
        toast.error(result.error || t('Proxy is unreachable'))
      }
    } catch (error) {
      handleServerError(error, t('Proxy test failed'))
    } finally {
      setIsTesting(false)
    }
  }

  const handleSave = async () => {
    if (!validateUrl(url, !isEdit)) return
    setIsSaving(true)
    try {
      const response = props.proxy
        ? await updateProxy({
            id: props.proxy.id,
            url: url.trim() || undefined,
            enabled,
          })
        : await createProxy({ url: url.trim(), enabled })
      if (!response.success) {
        handleServerError(response, t('Save failed'))
        return
      }
      toast.success(isEdit ? t('Proxy updated') : t('Proxy created'))
      queryClient.invalidateQueries({ queryKey: proxyPoolQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: proxyPoolQueryKeys.summary() })
      props.onOpenChange(false)
    } catch (error) {
      handleServerError(error, t('Save failed'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={isEdit ? t('Edit Proxy') : t('Add Proxy')}
      description={
        isEdit
          ? t(
              'Credentials are hidden. Enter a new address to replace the stored one, or leave it empty to keep it.'
            )
          : t(
              'Supports http, https, socks5, and socks5h, for example socks5://user:pass@host:1080'
            )
      }
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={isSaving}
          >
            {t('Cancel')}
          </Button>
          <Button
            variant='outline'
            onClick={handleTest}
            disabled={isSaving || isTesting}
          >
            {isTesting && (
              <Loader2 className='animate-spin' aria-hidden='true' />
            )}
            {t('Test')}
          </Button>
          <Button onClick={handleSave} disabled={isSaving || isTesting}>
            {isSaving && (
              <Loader2 className='animate-spin' aria-hidden='true' />
            )}
            {t('Save')}
          </Button>
        </>
      }
    >
      <div className='space-y-3'>
        <div className='space-y-2'>
          <Label htmlFor='proxy-url'>{t('Proxy Address')}</Label>
          <Input
            id='proxy-url'
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onBlur={() => validateUrl(url, !isEdit)}
            placeholder={
              isEdit && props.proxy
                ? props.proxy.url
                : t('socks5://user:pass@host:port')
            }
            aria-invalid={urlError ? true : undefined}
            aria-label={t('Proxy Address')}
          />
          {urlError ? (
            <p className='text-destructive text-xs'>{urlError}</p>
          ) : null}
        </div>
        <div className='flex items-center justify-between gap-4'>
          <div className='space-y-0.5'>
            <Label htmlFor='proxy-enabled'>{t('Available')}</Label>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Only available proxies are used by channels with dynamic proxy'
              )}
            </p>
          </div>
          <Switch
            id='proxy-enabled'
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label={t('Available')}
          />
        </div>
      </div>
    </Dialog>
  )
}
