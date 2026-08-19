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
import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import {
  CLIENT_REGEX_PRESETS,
  MAX_CLIENT_REGEX_LENGTH,
  MAX_RATE_LIMIT_VALUE,
  type ClientPreset,
  type RateLimitEntryData,
  isValidClientRegex,
} from './rate-limit-config'

const createRateLimitDialogSchema = (t: (key: string) => string) =>
  z.object({
    groupName: z
      .string()
      .min(1, t('Group name is required'))
      .refine((value) => value.trim() === value, {
        message: t('Group name cannot have leading or trailing spaces'),
      }),
    maxRequests: z
      .number()
      .int()
      .min(0, t('Must be at least 0'))
      .max(MAX_RATE_LIMIT_VALUE, t('Must be at most 2,147,483,647')),
    maxSuccess: z
      .number()
      .int()
      .min(1, t('Must be at least 1'))
      .max(MAX_RATE_LIMIT_VALUE, t('Must be at most 2,147,483,647')),
    clientPreset: z.enum([
      'unrestricted',
      'codex',
      'claude-code',
      'custom',
    ]),
    clientRegex: z.string().refine(isValidClientRegex, {
      message: t(
        'Enter a valid regular expression without surrounding spaces (maximum 512 characters)'
      ),
    }),
  })

type RateLimitDialogFormValues = z.infer<
  ReturnType<typeof createRateLimitDialogSchema>
>

const RATE_LIMIT_FORM_ID = 'rate-limit-form'

type RateLimitDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: RateLimitEntryData) => void
  editData?: RateLimitEntryData | null
}

export function RateLimitDialog({
  open,
  onOpenChange,
  onSave,
  editData,
}: RateLimitDialogProps) {
  const { t } = useTranslation()
  const isEditMode = !!editData
  const rateLimitDialogSchema = useMemo(
    () => createRateLimitDialogSchema(t),
    [t]
  )

  const form = useForm<RateLimitDialogFormValues>({
    resolver: zodResolver(rateLimitDialogSchema),
    defaultValues: {
      groupName: '',
      maxRequests: 0,
      maxSuccess: 1,
      clientPreset: 'unrestricted',
      clientRegex: '',
    },
  })

  useEffect(() => {
    if (editData) {
      form.reset(editData)
    } else {
      form.reset({
        groupName: '',
        maxRequests: 0,
        maxSuccess: 1,
        clientPreset: 'unrestricted',
        clientRegex: '',
      })
    }
  }, [editData, form, open])

  const handleSubmit = (values: RateLimitDialogFormValues) => {
    onSave(values)
    form.reset()
    onOpenChange(false)
  }

  const clientPreset = form.watch('clientPreset')
  const clientPresetItems = [
    { value: 'unrestricted', label: t('Unrestricted') },
    { value: 'codex', label: 'Codex' },
    { value: 'claude-code', label: 'Claude' },
    { value: 'custom', label: t('Custom regular expression') },
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        isEditMode ? t('Edit group rate limit') : t('Add group rate limit')
      }
      description={t(
        'Configure rate limiting rules for a specific user group.'
      )}
      contentClassName='sm:max-w-[500px]'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' form={RATE_LIMIT_FORM_ID}>
            {isEditMode ? t('Update') : t('Add')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id={RATE_LIMIT_FORM_ID}
          onSubmit={form.handleSubmit(handleSubmit)}
          className='space-y-4'
        >
          <FormField
            control={form.control}
            name='groupName'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Group Name')}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t('e.g., default, vip, premium')}
                    {...field}
                    disabled={isEditMode}
                  />
                </FormControl>
                <FormDescription>
                  {isEditMode
                    ? t('Group name cannot be changed when editing.')
                    : t('Unique identifier for this group.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='maxRequests'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Max Requests (including failures)')}</FormLabel>
                <FormControl>
                  <div className='flex items-center gap-2'>
                    <Input
                      type='number'
                      min={0}
                      max={MAX_RATE_LIMIT_VALUE}
                      step={1}
                      {...field}
                      onChange={(e) =>
                        field.onChange(Number.parseInt(e.target.value) || 0)
                      }
                    />
                    <span className='text-muted-foreground text-sm'>
                      {t('times')}
                    </span>
                  </div>
                </FormControl>
                <FormDescription>
                  {t('Total requests allowed per period. 0 = unlimited.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='maxSuccess'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Max Successful Requests')}</FormLabel>
                <FormControl>
                  <div className='flex items-center gap-2'>
                    <Input
                      type='number'
                      min={1}
                      max={MAX_RATE_LIMIT_VALUE}
                      step={1}
                      {...field}
                      onChange={(e) =>
                        field.onChange(Number.parseInt(e.target.value) || 1)
                      }
                    />
                    <span className='text-muted-foreground text-sm'>
                      {t('times')}
                    </span>
                  </div>
                </FormControl>
                <FormDescription>
                  {t('Only successful requests count toward this limit.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='clientPreset'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Allowed client')}</FormLabel>
                <Select
                  items={clientPresetItems}
                  value={field.value}
                  onValueChange={(value) => {
                    if (!value) return
                    const preset = value as ClientPreset
                    field.onChange(preset)
                    if (preset !== 'custom') {
                      const presetRegex =
                        CLIENT_REGEX_PRESETS[
                          preset as keyof typeof CLIENT_REGEX_PRESETS
                        ]
                      form.setValue('clientRegex', presetRegex, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                  }}
                >
                  <FormControl>
                    <SelectTrigger className='w-full'>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {clientPresetItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FormDescription>
                  {t('Presets are editable templates for common clients.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='clientRegex'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Client regular expression')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    maxLength={MAX_CLIENT_REGEX_LENGTH}
                    placeholder={t('Enter a Go RE2 regular expression')}
                    onChange={(event) => {
                      const clientRegex = event.target.value
                      field.onChange(clientRegex)
                      if (
                        clientPreset !== 'custom' &&
                        clientRegex !== CLIENT_REGEX_PRESETS[clientPreset]
                      ) {
                        form.setValue('clientPreset', 'custom', {
                          shouldDirty: true,
                        })
                      }
                    }}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Matches User-Agent or originator. Request headers can be forged, so this is an operational restriction rather than authentication.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Dialog>
  )
}
