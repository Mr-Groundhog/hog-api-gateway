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
import { useQuery } from '@tanstack/react-query'
import { Check, Loader2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { PasswordInput } from '@/components/password-input'
import {
  PasswordConfirmationStatus,
  PasswordStrength,
} from '@/components/password-strength'
import { Turnstile } from '@/components/turnstile'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import {
  checkRegistrationCode,
  register,
  wechatLoginByCode,
} from '@/features/auth/api'
import { LegalConsent } from '@/features/auth/components/legal-consent'
import { OAuthProviders } from '@/features/auth/components/oauth-providers'
import { registerFormSchema } from '@/features/auth/constants'
import { useAuthRedirect } from '@/features/auth/hooks/use-auth-redirect'
import { useEmailVerification } from '@/features/auth/hooks/use-email-verification'
import { useTurnstile } from '@/features/auth/hooks/use-turnstile'
import {
  getAffiliateCode,
  saveAffiliateCode,
} from '@/features/auth/lib/storage'
import { useDebounce } from '@/hooks/use-debounce'
import { useStatus } from '@/hooks/use-status'
import { isAuthBundle } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import {
  createServerError,
  getServerErrorMessageKey,
  requireServerSuccess,
} from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

export function SignUpForm({
  className,
  ...props
}: React.HTMLAttributes<HTMLFormElement>) {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)
  const [verificationCode, setVerificationCode] = useState('')
  const [agreedToLegal, setAgreedToLegal] = useState(false)
  const [wechatCode, setWeChatCode] = useState('')
  const [isWeChatDialogOpen, setIsWeChatDialogOpen] = useState(false)
  const [isWeChatSubmitting, setIsWeChatSubmitting] = useState(false)
  const [turnstileWidgetKey, setTurnstileWidgetKey] = useState(0)
  const legalConsentErrorMessage = t('Please agree to the legal terms first')

  const { status } = useStatus()
  const {
    isTurnstileEnabled,
    turnstileSiteKey,
    turnstileToken,
    setTurnstileToken,
    validateTurnstile,
  } = useTurnstile()
  const { redirectToLogin, handleLoginSuccess } = useAuthRedirect()
  const {
    isSending: isSendingCode,
    secondsLeft,
    isActive,
    sendCode,
  } = useEmailVerification({
    turnstileToken,
    validateTurnstile,
  })

  const form = useForm<z.infer<typeof registerFormSchema>>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
      registrationCode: '',
    },
  })
  const passwordValue = useWatch({ control: form.control, name: 'password' })
  const confirmationValue = useWatch({
    control: form.control,
    name: 'confirmPassword',
  })

  const emailValue = form.watch('email')
  const emailVerificationRequired = !!status?.email_verification
  const hasUserAgreement = Boolean(status?.user_agreement_enabled)
  const hasPrivacyPolicy = Boolean(status?.privacy_policy_enabled)
  const requiresLegalConsent = hasUserAgreement || hasPrivacyPolicy
  const registrationEnabled = Boolean(
    status?.register_enabled ?? status?.data?.register_enabled
  )
  const passwordRegistrationEnabled = Boolean(
    status?.password_register_enabled ?? status?.data?.password_register_enabled
  )
  let registrationDisabledMessage = ''
  if (!registrationEnabled) {
    registrationDisabledMessage = t(
      'New user registration has been disabled by administrator'
    )
  } else if (!passwordRegistrationEnabled) {
    registrationDisabledMessage = t(
      'Password registration has been disabled by administrator, please use third-party account verification'
    )
  }
  const hasWeChatLogin = Boolean(status?.wechat_login)
  const registrationCodeRequired = Boolean(
    status?.registration_code_enabled ?? status?.data?.registration_code_enabled
  )

  // Debounced registration-code pre-check: only fires after the user stops
  // typing (600ms), so we don't hit the API on every keystroke.
  const registrationCodeValue = (form.watch('registrationCode') ?? '').trim()
  const debouncedRegistrationCode = useDebounce(registrationCodeValue, 600)

  const regCodeQuery = useQuery({
    queryKey: ['registration-code-check', debouncedRegistrationCode],
    enabled:
      registrationEnabled &&
      registrationCodeRequired &&
      Boolean(registrationCodeValue) &&
      registrationCodeValue === debouncedRegistrationCode,
    queryFn: async ({ signal }) => {
      const response = requireServerSuccess(
        await checkRegistrationCode(debouncedRegistrationCode, signal)
      )
      if (!response.data) throw createServerError(response)
      return response.data
    },
    retry: false,
    gcTime: 0,
    meta: { errorToast: false },
  })
  let regCodeCheck: 'idle' | 'checking' | 'valid' | 'invalid' | 'error' = 'idle'
  if (registrationCodeRequired && registrationCodeValue) {
    if (
      registrationCodeValue !== debouncedRegistrationCode ||
      regCodeQuery.isPending ||
      regCodeQuery.isFetching
    ) {
      regCodeCheck = 'checking'
    } else if (regCodeQuery.isError) {
      regCodeCheck = 'error'
    } else {
      regCodeCheck = regCodeQuery.data?.valid === true ? 'valid' : 'invalid'
    }
  }
  const registrationGatedByCode =
    registrationCodeRequired && regCodeCheck !== 'valid'
  let registrationCodeMessage = ''
  if (regCodeCheck === 'checking') {
    registrationCodeMessage = t('Checking registration code...')
  } else if (regCodeCheck === 'error') {
    registrationCodeMessage = t(
      'Unable to validate registration code. Please try again.'
    )
  } else if (regCodeCheck === 'invalid') {
    if (regCodeQuery.data?.reason === 'used') {
      registrationCodeMessage = t('This registration code has been used')
    } else if (regCodeQuery.data?.reason === 'expired') {
      registrationCodeMessage = t('This registration code has expired')
    } else {
      registrationCodeMessage = t('Invalid registration code')
    }
  }
  const turnstileReady = !isTurnstileEnabled || Boolean(turnstileToken)

  const wechatQrCodeUrl = useMemo(() => {
    return (
      status?.wechat_qrcode ||
      status?.wechat_qr_code ||
      status?.wechat_qrcode_image_url ||
      status?.wechat_qr_code_image_url ||
      status?.wechat_account_qrcode_image_url ||
      status?.WeChatAccountQRCodeImageURL ||
      status?.data?.wechat_qrcode ||
      status?.data?.WeChatAccountQRCodeImageURL ||
      ''
    )
  }, [status])

  useEffect(() => {
    if (requiresLegalConsent) {
      setAgreedToLegal(false)
    } else {
      setAgreedToLegal(true)
    }
  }, [requiresLegalConsent])

  useEffect(() => {
    const aff = new URLSearchParams(window.location.search).get('aff')?.trim()
    if (aff) {
      saveAffiliateCode(aff)
    }
  }, [])

  async function onSubmit(data: z.infer<typeof registerFormSchema>) {
    if (!registrationEnabled || !passwordRegistrationEnabled) {
      toast.error(registrationDisabledMessage)
      return
    }
    if (requiresLegalConsent && !agreedToLegal) {
      toast.error(legalConsentErrorMessage)
      return
    }

    // Validate email verification if required
    if (emailVerificationRequired) {
      if (!data.email) {
        toast.error(t('Please enter your email'))
        return
      }
      if (!verificationCode) {
        toast.error(t('Please enter the verification code'))
        return
      }
    }

    if (!validateTurnstile()) return

    if (registrationCodeRequired && !data.registrationCode?.trim()) {
      toast.error(t('Please enter the registration code'))
      return
    }
    if (registrationGatedByCode) {
      toast.error(
        registrationCodeMessage || t('Please enter the registration code')
      )
      return
    }

    setIsLoading(true)
    try {
      const res = await register({
        username: data.username,
        password: data.password,
        email: data.email || undefined,
        verification_code: verificationCode || undefined,
        aff_code: getAffiliateCode(),
        registration_code: data.registrationCode?.trim() || undefined,
        turnstile: turnstileToken,
      })

      if (res?.success) {
        toast.success(t('Account created! Please sign in'))
        redirectToLogin()
      } else {
        handleServerError(createServerError(res))
        if (registrationCodeRequired) void regCodeQuery.refetch()
      }
    } catch (error: unknown) {
      handleServerError(error)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSendVerificationCode() {
    if (await sendCode(emailValue || '')) {
      setTurnstileToken('')
      setTurnstileWidgetKey((current) => current + 1)
    }
  }

  const handleOpenWeChatDialog = () => {
    if (requiresLegalConsent && !agreedToLegal) {
      toast.error(legalConsentErrorMessage)
      return
    }

    setIsWeChatDialogOpen(true)
  }

  const handleWeChatDialogChange = (open: boolean) => {
    setIsWeChatDialogOpen(open)
    if (!open) {
      setWeChatCode('')
      setIsWeChatSubmitting(false)
    }
  }

  async function handleWeChatLogin() {
    if (!wechatCode.trim()) {
      toast.error(t('Please enter the verification code'))
      return
    }

    setIsWeChatSubmitting(true)
    try {
      const res = await wechatLoginByCode(wechatCode)
      if (res?.success && isAuthBundle(res.data)) {
        await handleLoginSuccess(res.data)
        toast.success(t('Signed in via WeChat'))
        handleWeChatDialogChange(false)
      } else {
        if (getServerErrorMessageKey(res)) return
        toast.error(res?.message || t('Login failed'))
      }
    } catch (error: unknown) {
      if (getServerErrorMessageKey(error)) return
      toast.error(t('Login failed'))
    } finally {
      setIsWeChatSubmitting(false)
    }
  }

  let verificationCodeAction: ReactNode = t('Send code')
  if (isActive) {
    verificationCodeAction = t('Resend ({{seconds}}s)', {
      seconds: secondsLeft,
    })
  } else if (isSendingCode) {
    verificationCodeAction = <Loader2 className='h-4 w-4 animate-spin' />
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-4', className)}
        {...props}
      >
        {/* Username Field */}
        <FormField
          control={form.control}
          name='username'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Username')}</FormLabel>
              <FormControl>
                <Input placeholder={t('Enter your username')} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Password Field */}
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Password')}</FormLabel>
              <FormControl describedBy='sign-up-password-strength'>
                <PasswordInput
                  placeholder={t('Enter password (8–128 characters)')}
                  autoComplete='new-password'
                  {...field}
                />
              </FormControl>
              <PasswordStrength
                id='sign-up-password-strength'
                value={passwordValue}
                showRules={false}
              />
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Confirm Password Field */}
        <FormField
          control={form.control}
          name='confirmPassword'
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>{t('Confirm password')}</FormLabel>
              <FormControl describedBy='sign-up-password-confirmation-status'>
                <PasswordInput
                  placeholder={t('Confirm password')}
                  autoComplete='new-password'
                  {...field}
                />
              </FormControl>
              <PasswordConfirmationStatus
                id='sign-up-password-confirmation-status'
                password={passwordValue}
                confirmation={confirmationValue}
                hasFieldError={!!fieldState.error}
              />
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Email Verification Section */}
        {emailVerificationRequired && (
          <>
            {/* Email Field */}
            <FormField
              control={form.control}
              name='email'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Email (required for verification)')}
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('name@example.com')}
                      type='email'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Verification Code Field */}
            <div className='flex items-end gap-2'>
              <div className='flex-1'>
                <Input
                  placeholder={t('Verification code')}
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                />
              </div>
              <Button
                variant='outline'
                type='button'
                disabled={
                  isLoading ||
                  isSendingCode ||
                  isActive ||
                  !emailValue ||
                  !turnstileReady
                }
                onClick={handleSendVerificationCode}
              >
                {verificationCodeAction}
              </Button>
            </div>
          </>
        )}

        {/* Registration Code Field */}
        {registrationCodeRequired && (
          <FormField
            control={form.control}
            name='registrationCode'
            render={({ field }) => (
              <FormItem
                data-invalid={
                  regCodeCheck === 'invalid' || regCodeCheck === 'error'
                }
              >
                <FormLabel>{t('Registration code')}</FormLabel>
                <InputGroup>
                  <FormControl describedBy='registration-code-status'>
                    <InputGroupInput
                      placeholder={t('Enter the registration code')}
                      required
                      {...field}
                      aria-invalid={
                        regCodeCheck === 'invalid' || regCodeCheck === 'error'
                      }
                    />
                  </FormControl>
                  <InputGroupAddon align='inline-end'>
                    {regCodeCheck === 'valid' && (
                      <Check
                        aria-hidden='true'
                        className='size-4 text-emerald-600'
                      />
                    )}
                    {(regCodeCheck === 'invalid' ||
                      regCodeCheck === 'error') && (
                      <X
                        aria-hidden='true'
                        className='text-destructive size-4'
                      />
                    )}
                    {regCodeCheck === 'checking' && (
                      <Loader2
                        aria-hidden='true'
                        className='text-muted-foreground size-4 animate-spin'
                      />
                    )}
                  </InputGroupAddon>
                </InputGroup>
                <p
                  id='registration-code-status'
                  role='status'
                  aria-live='polite'
                  className={cn(
                    'text-sm',
                    regCodeCheck === 'checking'
                      ? 'text-muted-foreground'
                      : 'text-destructive'
                  )}
                >
                  {registrationCodeMessage}
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Turnstile */}
        {isTurnstileEnabled && (
          <div className='mt-2'>
            <Turnstile
              key={turnstileWidgetKey}
              siteKey={turnstileSiteKey}
              onVerify={setTurnstileToken}
            />
          </div>
        )}

        <LegalConsent
          status={status}
          checked={agreedToLegal}
          onCheckedChange={setAgreedToLegal}
          className='mt-1'
        />

        {/* Submit Button */}
        <Button
          type='submit'
          className='mt-2 w-full justify-center gap-2'
          disabled={
            !registrationEnabled ||
            !passwordRegistrationEnabled ||
            isLoading ||
            (requiresLegalConsent && !agreedToLegal) ||
            !turnstileReady ||
            registrationGatedByCode
          }
        >
          {isLoading ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
          {t('Create account')}
        </Button>

        {registrationDisabledMessage && (
          <p
            role='status'
            className='text-muted-foreground text-center text-sm'
          >
            {registrationDisabledMessage}
          </p>
        )}
        <OAuthProviders
          status={status}
          disabled={
            !registrationEnabled ||
            isLoading ||
            (requiresLegalConsent && !agreedToLegal) ||
            registrationGatedByCode
          }
          getRegistrationCode={
            registrationCodeRequired && !registrationGatedByCode
              ? () => registrationCodeValue || undefined
              : undefined
          }
          disabledProviders={
            registrationCodeRequired ? ['wechat', 'telegram'] : undefined
          }
          onWeChatLogin={handleOpenWeChatDialog}
          isWeChatLoading={isWeChatSubmitting}
          className='pt-2'
        />
        {registrationGatedByCode && (
          <p className='text-muted-foreground -mt-1 text-center text-sm'>
            {t(
              'Enter a valid registration code before signing up with a third-party account'
            )}
          </p>
        )}
      </form>

      {hasWeChatLogin && (
        <Dialog
          open={isWeChatDialogOpen}
          onOpenChange={handleWeChatDialogChange}
          title={t('WeChat sign in')}
          description={t(
            'Scan the QR code to follow the official account and reply with “验证码” to receive your verification code.'
          )}
          contentClassName='max-w-sm'
          headerClassName='text-left'
          contentHeight='auto'
          bodyClassName='space-y-4'
          footer={
            <>
              <Button
                type='button'
                variant='outline'
                onClick={() => handleWeChatDialogChange(false)}
                disabled={isWeChatSubmitting}
              >
                {t('Cancel')}
              </Button>
              <Button
                type='button'
                onClick={handleWeChatLogin}
                disabled={
                  isWeChatSubmitting ||
                  !wechatCode.trim() ||
                  (requiresLegalConsent && !agreedToLegal)
                }
                className='gap-2'
              >
                {isWeChatSubmitting ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : null}
                {t('Confirm')}
              </Button>
            </>
          }
        >
          {wechatQrCodeUrl ? (
            <div className='flex justify-center'>
              <img
                src={wechatQrCodeUrl}
                alt={t('WeChat login QR code')}
                className='h-40 w-40 rounded-md border object-contain'
              />
            </div>
          ) : (
            <p className='text-muted-foreground text-sm'>
              {t('QR code is not configured. Please contact support.')}
            </p>
          )}
          <div className='grid gap-2'>
            <Label htmlFor='wechat-code'>{t('Verification code')}</Label>
            <Input
              id='wechat-code'
              placeholder={t('Enter the verification code')}
              value={wechatCode}
              onChange={(event) => setWeChatCode(event.target.value)}
              autoComplete='one-time-code'
            />
          </div>
        </Dialog>
      )}
    </Form>
  )
}
