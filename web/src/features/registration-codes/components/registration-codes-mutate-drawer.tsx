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
import { type FormEvent, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DateTimePicker } from '@/components/datetime-picker'
import {
  SideDrawerSection,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
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
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { addTimeToDate } from '@/lib/time'

import { updateRegistrationCode } from '../api'
import { SUCCESS_MESSAGES } from '../constants'
import {
  getRegistrationCodeFormSchema,
  type RegistrationCodeFormValues,
  REGISTRATION_CODE_FORM_DEFAULT_VALUES,
  transformFormDataToPayload,
  transformRegistrationCodeToFormDefaults,
} from '../lib'
import type { RegistrationCode } from '../types'
import { useRegistrationCodes } from './registration-codes-provider'

type RegistrationCodesMutateDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: RegistrationCode
}

export function RegistrationCodesMutateDrawer({
  open,
  onOpenChange,
  currentRow,
}: RegistrationCodesMutateDrawerProps) {
  const { t } = useTranslation()
  const { triggerRefresh } = useRegistrationCodes()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<RegistrationCodeFormValues>({
    resolver: zodResolver(getRegistrationCodeFormSchema(t)),
    defaultValues: REGISTRATION_CODE_FORM_DEFAULT_VALUES,
  })

  // Seed the form from currentRow when updating
  useEffect(() => {
    if (!open || !currentRow) return
    form.reset(transformRegistrationCodeToFormDefaults(currentRow))
  }, [open, currentRow, form])

  const onSubmit = async (data: RegistrationCodeFormValues) => {
    if (!currentRow) return
    setIsSubmitting(true)
    try {
      const payload = transformFormDataToPayload(data)
      const result = await updateRegistrationCode({
        ...payload,
        id: currentRow.id,
      })
      if (result.success) {
        toast.success(t(SUCCESS_MESSAGES.REGISTRATION_CODE_UPDATED))
        onOpenChange(false)
        triggerRefresh()
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    void form.handleSubmit(onSubmit)(event)
  }

  const handleSetExpiry = (months: number, days: number, hours: number) => {
    form.setValue('expired_time', addTimeToDate(months, days, hours))
  }

  let submitButtonLabel = t('Save changes')
  if (isSubmitting) {
    submitButtonLabel = t('Saving...')
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) {
          form.reset()
        }
      }}
    >
      <SheetContent
        className={sideDrawerContentClassName('sm:max-w-[600px]')}
      >
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>{t('Update Registration Code')}</SheetTitle>
          <SheetDescription>
            {t('Update the registration code by providing necessary info.')}{' '}
            {t("Click save when you're done.")}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='registration-code-form'
            onSubmit={handleSubmit}
            className={sideDrawerFormClassName()}
          >
            <fieldset disabled={isSubmitting} className='contents'>
              <SideDrawerSection>
                <FormField
                  control={form.control}
                  name='name'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Name')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t('Enter a name')}
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Name for this registration code (1-20 characters)'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='expired_time'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Expiration Time')}</FormLabel>
                      <div className='flex flex-col gap-2'>
                        <FormControl>
                          <DateTimePicker
                            value={field.value}
                            onChange={field.onChange}
                            placeholder={t('Never expires')}
                          />
                        </FormControl>
                        <div className='grid grid-cols-4 gap-1.5 sm:flex sm:gap-2'>
                          <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            onClick={() => handleSetExpiry(0, 0, 0)}
                          >
                            {t('Never')}
                          </Button>
                          <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            onClick={() => handleSetExpiry(1, 0, 0)}
                          >
                            {t('1M')}
                          </Button>
                          <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            onClick={() => handleSetExpiry(0, 7, 0)}
                          >
                            {t('1W')}
                          </Button>
                          <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            onClick={() => handleSetExpiry(0, 1, 0)}
                          >
                            {t('1 Day')}
                          </Button>
                        </div>
                      </div>
                      <FormDescription>
                        {t('Leave empty for never expires')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

              </SideDrawerSection>
            </fieldset>
          </form>
        </Form>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button variant='outline' />}>
            {t('Close')}
          </SheetClose>
          <Button
            form='registration-code-form'
            type='submit'
            disabled={isSubmitting}
          >
            {submitButtonLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
