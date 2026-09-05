/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
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
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { createTicket, ticketQueryKeys } from '../api'
import {
  SUCCESS_MESSAGES,
  TICKET_TYPES,
  TICKET_VALIDATION,
  getTicketTypeOptions,
} from '../constants'
import {
  TICKET_FORM_DEFAULT_VALUES,
  getTicketFormSchema,
  runeLength,
  transformTicketFormToPayload,
  type TicketFormValues,
} from '../lib/ticket-form'

type TicketCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 「新增工单」弹窗：纯文本输入，类型 / 标题 / 内容三字段。 */
export function TicketCreateDialog(props: TicketCreateDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<TicketFormValues>({
    resolver: zodResolver(getTicketFormSchema(t)),
    defaultValues: TICKET_FORM_DEFAULT_VALUES,
  })
  useEffect(() => {
    if (props.open) {
      form.reset(TICKET_FORM_DEFAULT_VALUES)
    }
  }, [props.open, form])

  const onSubmit = async (values: TicketFormValues) => {
    try {
      await createTicket(transformTicketFormToPayload(values))
      toast.success(t(SUCCESS_MESSAGES.TICKET_CREATED))
      props.onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: ticketQueryKeys.list })
    } catch (error) {
      // 后端校验消息已按用户语言本地化（requireData 抛出 message），直接展示
      if (error instanceof Error && error.message) {
        toast.error(error.message)
      } else {
        handleServerError(error)
      }
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('New Ticket')}</DialogTitle>
          <DialogDescription>
            {t('Submit your first ticket and we will get back to you.')}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id='ticket-create-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className='flex flex-col gap-4'
          >
            <FormField
              control={form.control}
              name='type'
              render={({ field }) => {
                const selectedType = TICKET_TYPES[field.value]
                return (
                  <FormItem>
                    <FormLabel>{t('Ticket Type')}</FormLabel>
                    <FormControl>
                      <Select
                        value={String(field.value)}
                        onValueChange={(value) => field.onChange(Number(value))}
                      >
                        <SelectTrigger className='w-full'>
                          {/* Base UI 的 SelectValue 默认渲染原始 value，需显式给出文案 */}
                          <SelectValue>
                            {selectedType ? t(selectedType.labelKey) : ''}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {getTicketTypeOptions(t).map((option) => (
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
              name='title'
              render={({ field }) => (
                <FormItem>
                  <div className='flex items-center justify-between'>
                    <FormLabel>{t('Ticket Title')}</FormLabel>
                    <span
                      className='text-muted-foreground text-xs'
                      aria-live='polite'
                    >
                      {t('{{current}} / {{max}}', {
                        current: runeLength(field.value ?? ''),
                        max: TICKET_VALIDATION.TITLE_MAX_LENGTH,
                      })}
                    </span>
                  </div>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={TICKET_VALIDATION.TITLE_MAX_LENGTH}
                      placeholder={t('Ticket Title')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='content'
              render={({ field }) => (
                <FormItem>
                  <div className='flex items-center justify-between'>
                    <FormLabel>{t('Ticket Content')}</FormLabel>
                    <span
                      className='text-muted-foreground text-xs'
                      aria-live='polite'
                    >
                      {t('{{current}} / {{max}}', {
                        current: runeLength(field.value ?? ''),
                        max: TICKET_VALIDATION.CONTENT_MAX_LENGTH,
                      })}
                    </span>
                  </div>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={10}
                      maxLength={TICKET_VALIDATION.CONTENT_MAX_LENGTH}
                      placeholder={t('Ticket Content')}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Describe the symptom, when it happened and the request ID so we can locate it.'
                    )}
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
            form='ticket-create-form'
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? t('Submitting...') : t('Submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
