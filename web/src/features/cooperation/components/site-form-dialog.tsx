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

import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import {
  addCooperationSite,
  cooperationQueryKeys,
  updateCooperationSite,
} from '../api'
import {
  COOPERATION_SITE_TYPES,
  getCooperationSiteTypeOptions,
} from '../constants'
import {
  COOPERATION_SITE_FORM_DEFAULT_VALUES,
  COOPERATION_SITE_VALIDATION,
  getCooperationSiteFormSchema,
  runeLength,
  transformCooperationSiteFormToPayload,
  type CooperationSiteFormValues,
} from '../lib/cooperation-form'
import type { CooperationSiteEntry } from '../types'

type SiteFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 编辑中的站点；null 表示新建 */
  site: CooperationSiteEntry | null
  /** 新建时的预填值（如从已通过的合作申请带入）；编辑模式下忽略 */
  initialValues?: CooperationSiteFormValues | null
}

function toFormValues(
  site: CooperationSiteEntry | null,
  initialValues?: CooperationSiteFormValues | null
): CooperationSiteFormValues {
  if (site) {
    return {
      name: site.name,
      url: site.url,
      logo: site.logo,
      banner: site.banner,
      siteType: site.site_type ?? '',
      description: site.description,
      sort: String(site.sort),
      featured: site.featured,
      enabled: site.enabled,
    }
  }
  if (initialValues) {
    return { ...COOPERATION_SITE_FORM_DEFAULT_VALUES, ...initialValues }
  }
  return COOPERATION_SITE_FORM_DEFAULT_VALUES
}

/** 「新增 / 编辑合作站点」弹窗：站点信息 + 轮播图 + 排序与展示开关。 */
export function SiteFormDialog(props: SiteFormDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<CooperationSiteFormValues>({
    resolver: zodResolver(getCooperationSiteFormSchema(t)),
    defaultValues: toFormValues(props.site, props.initialValues),
  })
  useEffect(() => {
    if (props.open) {
      form.reset(toFormValues(props.site, props.initialValues))
    }
  }, [props.open, props.site, props.initialValues, form])

  const onSubmit = async (values: CooperationSiteFormValues) => {
    const payload = transformCooperationSiteFormToPayload(
      values,
      props.site?.id
    )
    try {
      if (props.site) {
        await updateCooperationSite(payload)
        toast.success(t('Site updated'))
      } else {
        await addCooperationSite(payload)
        toast.success(t('Site created'))
      }
      props.onOpenChange(false)
      void queryClient.invalidateQueries({
        queryKey: cooperationQueryKeys.adminSites,
      })
    } catch (error) {
      if (error instanceof Error && error.message) {
        toast.error(error.message)
      } else {
        handleServerError(error)
      }
    }
  }

  const renderCounter = (value: string, max: number) => (
    <span className='text-muted-foreground text-xs' aria-live='polite'>
      {t('{{current}} / {{max}}', { current: runeLength(value ?? ''), max })}
    </span>
  )

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {props.site ? t('Edit Site') : t('Add Site')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'Featured sites are displayed first; sort order is ascending.'
            )}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id='cooperation-site-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className='flex flex-col gap-4'
          >
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <div className='flex items-center justify-between'>
                    <FormLabel>{t('Site Name')}</FormLabel>
                    {renderCounter(
                      field.value ?? '',
                      COOPERATION_SITE_VALIDATION.NAME_MAX_LENGTH
                    )}
                  </div>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={COOPERATION_SITE_VALIDATION.NAME_MAX_LENGTH}
                      placeholder={t('Site Name')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='url'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Site URL')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode='url'
                      maxLength={COOPERATION_SITE_VALIDATION.URL_MAX_LENGTH}
                      placeholder='https://example.com'
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='logo'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Logo URL')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode='url'
                      maxLength={COOPERATION_SITE_VALIDATION.URL_MAX_LENGTH}
                      placeholder='https://example.com/logo.png'
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Optional. Shown on site cards.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='banner'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Banner URL')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode='url'
                      maxLength={COOPERATION_SITE_VALIDATION.URL_MAX_LENGTH}
                      placeholder='https://example.com/banner.png'
                    />
                  </FormControl>
                  {field.value && (
                    <img
                      src={field.value}
                      alt=''
                      loading='lazy'
                      className='h-36 w-full rounded-lg border object-cover'
                    />
                  )}
                  <FormDescription>
                    {t('Optional. Shown at the top of the site card.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='siteType'
              render={({ field }) => {
                const selectedType = field.value
                  ? COOPERATION_SITE_TYPES[
                      field.value as keyof typeof COOPERATION_SITE_TYPES
                    ]
                  : undefined
                return (
                  <FormItem>
                    <FormLabel>{t('Site Type')}</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value || undefined}
                        onValueChange={(value) =>
                          field.onChange(value === 'none' ? '' : value)
                        }
                      >
                        <SelectTrigger className='w-full'>
                          <SelectValue>
                            {selectedType
                              ? t(selectedType.labelKey)
                              : t('Not set')}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='none'>
                            {t('Not set')}
                          </SelectItem>
                          {getCooperationSiteTypeOptions(t).map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Optional. Shown on the site card as a corner badge.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )
              }}
            />

            <FormField
              control={form.control}
              name='description'
              render={({ field }) => (
                <FormItem>
                  <div className='flex items-center justify-between'>
                    <FormLabel>{t('Site Description')}</FormLabel>
                    {renderCounter(
                      field.value ?? '',
                      COOPERATION_SITE_VALIDATION.DESCRIPTION_MAX_LENGTH
                    )}
                  </div>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      maxLength={
                        COOPERATION_SITE_VALIDATION.DESCRIPTION_MAX_LENGTH
                      }
                      placeholder={t('Site Description')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='sort'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Sort Order')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode='numeric'
                      placeholder='0'
                      className='w-28'
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Sites with smaller numbers are displayed first.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='grid grid-cols-2 gap-4'>
              <FormField
                control={form.control}
                name='featured'
                render={({ field }) => (
                  <FormItem className='bg-card rounded-lg border p-3'>
                    <div className='flex items-center justify-between gap-2'>
                      <FormLabel className='text-sm'>{t('Featured')}</FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </div>
                    <p className='text-muted-foreground text-xs'>
                      {t('Display before other sites on the partner sites page.')}
                    </p>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='enabled'
                render={({ field }) => (
                  <FormItem className='bg-card rounded-lg border p-3'>
                    <div className='flex items-center justify-between gap-2'>
                      <FormLabel className='text-sm'>{t('Enabled')}</FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </div>
                    <p className='text-muted-foreground text-xs'>
                      {t('Visible on the partner sites page.')}
                    </p>
                  </FormItem>
                )}
              />
            </div>
          </form>
        </Form>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='submit'
            form='cooperation-site-form'
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? t('Submitting...') : t('Submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
