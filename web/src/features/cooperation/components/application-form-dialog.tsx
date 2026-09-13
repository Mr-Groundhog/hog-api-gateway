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
import { Checkbox } from '@/components/ui/checkbox'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { createCooperationApplication, cooperationQueryKeys } from '../api'
import {
  COOPERATION_SITE_TYPES,
  COOPERATION_VALIDATION,
  getCooperationMethodLabel,
  getCooperationSiteTypeOptions,
  type CooperationMethodOption,
} from '../constants'
import {
  COOPERATION_FORM_DEFAULT_VALUES,
  getCooperationFormSchema,
  runeLength,
  transformCooperationFormToPayload,
  type CooperationFormValues,
} from '../lib/cooperation-form'

type ApplicationFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 管理端开放的合作方式（CooperationMethodsAdmin，含自定义），空时回落内置全集 */
  enabledMethods: CooperationMethodOption[]
}

/** 「提交合作申请」弹窗：站点信息 + 合作方式（多选，按管理端开放列表）+ 联系方式与补充说明。 */
export function ApplicationFormDialog(props: ApplicationFormDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const enabledMethods = props.enabledMethods
  const form = useForm<CooperationFormValues>({
    resolver: zodResolver(getCooperationFormSchema(t)),
    defaultValues: COOPERATION_FORM_DEFAULT_VALUES,
  })
  useEffect(() => {
    if (props.open) {
      form.reset(COOPERATION_FORM_DEFAULT_VALUES)
    }
  }, [props.open, form])

  const onSubmit = async (values: CooperationFormValues) => {
    try {
      await createCooperationApplication(
        transformCooperationFormToPayload(values)
      )
      toast.success(t('Application submitted successfully'))
      props.onOpenChange(false)
      void queryClient.invalidateQueries({
        queryKey: cooperationQueryKeys.myApplications,
      })
    } catch (error) {
      // 后端校验消息已按用户语言本地化（requireData 抛出 message），直接展示
      if (error instanceof Error && error.message) {
        toast.error(error.message)
      } else {
        handleServerError(error)
      }
    }
  }

  const renderCounter = (value: string, max: number) => (
    <span className='text-muted-foreground text-xs' aria-live='polite'>
      {t('{{current}} / {{max}}', {
        current: runeLength(value ?? ''),
        max,
      })}
    </span>
  )

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>{t('Submit Cooperation Application')}</DialogTitle>
          <DialogDescription>
            {t(
              'Tell us about your site and how you would like to cooperate. Our team will review it and get back to you.'
            )}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id='cooperation-apply-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className='flex flex-col gap-4'
          >
            <FormField
              control={form.control}
              name='siteName'
              render={({ field }) => (
                <FormItem>
                  <div className='flex items-center justify-between'>
                    <FormLabel>{t('Site Name')}</FormLabel>
                    {renderCounter(
                      field.value ?? '',
                      COOPERATION_VALIDATION.SITE_NAME_MAX_LENGTH
                    )}
                  </div>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={COOPERATION_VALIDATION.SITE_NAME_MAX_LENGTH}
                      placeholder={t('Site Name')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='siteUrl'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Site URL')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode='url'
                      maxLength={COOPERATION_VALIDATION.SITE_URL_MAX_LENGTH}
                      placeholder='https://example.com'
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='siteBanner'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Site Banner URL')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode='url'
                      maxLength={COOPERATION_VALIDATION.SITE_URL_MAX_LENGTH}
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
                    {t(
                      'Optional image hosted on your own image bed; shown with your application.'
                    )}
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
                        onValueChange={(value) => field.onChange(value)}
                      >
                        <SelectTrigger className='w-full'>
                          {/* Base UI 的 SelectValue 默认渲染原始 value，需显式给出文案 */}
                          <SelectValue>
                            {selectedType
                              ? t(selectedType.labelKey)
                              : t('Select site type')}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {getCooperationSiteTypeOptions(t).map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
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
                      COOPERATION_VALIDATION.DESCRIPTION_MAX_LENGTH
                    )}
                  </div>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={4}
                      maxLength={COOPERATION_VALIDATION.DESCRIPTION_MAX_LENGTH}
                      placeholder={t('Site Description')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='audience'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Audience Size')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={COOPERATION_VALIDATION.AUDIENCE_MAX_LENGTH}
                      placeholder={t('e.g. 10k monthly visits or 5k followers')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='methods'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Cooperation Methods')}</FormLabel>
                  {/* 多选网格不用 FormControl：它假定单一控件（id 注入 / aria
                      绑定），多个 checkbox 各自显式声明 id 与 label 配对 */}
                  <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
                    {enabledMethods.map((option) => {
                      const methodId = `cooperation-method-${option.id}`
                      const checked = field.value.includes(option.id)
                      return (
                        <Label
                          key={option.id}
                          htmlFor={methodId}
                          className='has-data-checked:border-primary flex cursor-pointer items-center gap-2.5 rounded-md border p-3 text-sm font-normal'
                        >
                          <Checkbox
                            id={methodId}
                            checked={checked}
                            onCheckedChange={(value) => {
                              if (value === true) {
                                field.onChange([...field.value, option.id])
                              } else {
                                field.onChange(
                                  field.value.filter(
                                    (item) => item !== option.id
                                  )
                                )
                              }
                            }}
                          />
                          {getCooperationMethodLabel(option, option.id, t)}
                        </Label>
                      )
                    })}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='contact'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Contact Information')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={COOPERATION_VALIDATION.CONTACT_MAX_LENGTH}
                      placeholder={t('e.g. email, Telegram or QQ')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='notes'
              render={({ field }) => (
                <FormItem>
                  <div className='flex items-center justify-between'>
                    <FormLabel>{t('Additional Notes')}</FormLabel>
                    {renderCounter(
                      field.value ?? '',
                      COOPERATION_VALIDATION.NOTES_MAX_LENGTH
                    )}
                  </div>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      maxLength={COOPERATION_VALIDATION.NOTES_MAX_LENGTH}
                      placeholder={t('Anything else you want to tell us')}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Optional. Describe your cooperation idea in detail.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
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
            form='cooperation-apply-form'
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? t('Submitting...') : t('Submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
