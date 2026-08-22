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
import { Check, Loader2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { PasswordInput } from '@/components/password-input'
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
import { Label } from '@/components/ui/label'
import { checkRegistrationCode, register, wechatLoginByCode } from '@/features/auth/api'
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
import { getServerErrorMessageKey } from '@/lib/server-error-message'
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

  const emailValue = form.watch('email')
  const emailVerificationRequired = !!status?.email_verification
  const hasUserAgreement = Boolean(status?.user_agreement_enabled)
  const hasPrivacyPolicy = Boolean(status?.privacy_policy_enabled)
  const requiresLegalConsent = hasUserAgreement || hasPrivacyPolicy
  const oauthRegisterEnabled =
    status?.oauth_register_enabled ??
    status?.data?.oauth_register_enabled ??
    true
  const hasWeChatLogin = Boolean(status?.wechat_login)
  const registrationCodeRequired = Boolean(
    status?.registration_code_enabled ?? status?.data?.registration_code_enabled
  )

  // Debounced registration-code pre-check: only fires after the user stops
  // typing (600ms), so we don't hit the API on every keystroke.
  const [regCodeCheck, setRegCodeCheck] = useState<
    'idle' | 'checking' | 'valid' | 'invalid'
  >('idle')
  const [regCodeReason, setRegCodeReason] = useState('')
  // 开启注册码校验后，第三方注册也必须先通过注册码预校验才能点击
  const oauthGatedByRegistrationCode =
    registrationCodeRequired && regCodeCheck !== 'valid'
  const registrationCodeValue = form.watch('registrationCode') ?? ''
  const debouncedRegistrationCode = useDebounce(
    registrationCodeValue.trim(),
    600
  )

  useEffect(() => {
    if (!registrationCodeRequired || !debouncedRegistrationCode) {
      setRegCodeCheck('idle')
      setRegCodeReason('')
      return
    }
    let ignoreResult = false
    setRegCodeCheck('checking')
    setRegCodeReason('')
    void checkRegistrationCode(debouncedRegistrationCode)
      .then((res) => {
        if (ignoreResult) return
        if (res?.success && res.data) {
          setRegCodeCheck(res.data.valid ? 'valid' : 'invalid')
          setRegCodeReason(res.data.reason ?? 'invalid')
        } else {
          // Pre-check failed (network etc.) — don't block submit here;
          // the server still validates on registration.
          setRegCodeCheck('idle')
        }
      })
      .catch(() => {
        if (!ignoreResult) setRegCodeCheck('idle')
      })
    return () => {
      ignoreResult = true
    }
  }, [debouncedRegistrationCode, registrationCodeRequired])

  const registrationCodeMessage =
    regCodeCheck === 'valid' || regCodeCheck === 'checking'
      ? ''
      : regCodeReason === 'used'
        ? t('This registration code has been used')
        : regCodeReason === 'expired'
          ? t('This registration code has expired')
          : regCodeCheck === 'invalid'
            ? t('Invalid registration code')
            : ''
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
    if (registrationCodeRequired && regCodeCheck === 'checking') {
      toast.error(t('Checking registration code...'))
      return
    }
    if (registrationCodeRequired && regCodeCheck === 'invalid') {
      toast.error(registrationCodeMessage || t('Invalid registration code'))
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
      }
      // Failure toasts are already shown by the global API interceptor;
      // toasting again here would duplicate the message.
    } catch {
      // Errors are handled by global interceptor
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
              <FormControl>
                <PasswordInput
                  placeholder={t('Enter password (8-20 characters)')}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Confirm Password Field */}
        <FormField
          control={form.control}
          name='confirmPassword'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Confirm password')}</FormLabel>
              <FormControl>
                <PasswordInput placeholder={t('Confirm password')} {...field} />
              </FormControl>
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
              <FormItem>
                <FormLabel>{t('Registration code')}</FormLabel>
                <FormControl>
                  <div className='relative'>
                    <Input
                      placeholder={t('Enter the registration code')}
                      className='pe-10'
                      {...field}
                    />
                    {registrationCodeRequired && regCodeCheck === 'valid' && (
                      <Check className='text-emerald-600 pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2' />
                    )}
                    {registrationCodeRequired &&
                      regCodeCheck === 'invalid' && (
                        <X className='text-destructive pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2' />
                      )}
                    {registrationCodeRequired && regCodeCheck === 'checking' && (
                      <Loader2 className='text-muted-foreground pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin' />
                    )}
                  </div>
                </FormControl>
                {registrationCodeMessage ? (
                  <p
                    className={cn(
                      'text-sm',
                      regCodeCheck === 'valid'
                        ? 'text-muted-foreground'
                        : regCodeCheck === 'checking'
                          ? 'text-muted-foreground'
                          : 'text-destructive'
                    )}
                  >
                    {registrationCodeMessage}
                  </p>
                ) : null}
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
            isLoading ||
            (requiresLegalConsent && !agreedToLegal) ||
            !turnstileReady
          }
        >
          {isLoading ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
          {t('Create account')}
        </Button>

        {oauthRegisterEnabled && (
          <>
            <OAuthProviders
              status={status}
              disabled={
                isLoading ||
                (requiresLegalConsent && !agreedToLegal) ||
                oauthGatedByRegistrationCode
              }
              getRegistrationCode={
                registrationCodeRequired && regCodeCheck === 'valid'
                  ? () => registrationCodeValue.trim() || undefined
                  : undefined
              }
              disabledProviders={
                registrationCodeRequired
                  ? ['wechat', 'telegram']
                  : undefined
              }
              onWeChatLogin={handleOpenWeChatDialog}
              isWeChatLoading={isWeChatSubmitting}
              className='pt-2'
            />
            {oauthGatedByRegistrationCode && (
              <p className='text-muted-foreground -mt-1 text-center text-sm'>
                {t(
                  'Enter a valid registration code before signing up with a third-party account'
                )}
              </p>
            )}
          </>
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
