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
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  IconDiscord,
  IconGithub,
  IconLinuxDo,
  IconTelegram,
  IconWeChat,
} from '@/assets/brand-icons'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { useOAuthLogin } from '../hooks/use-oauth-login'
import type { SystemStatus } from '../types'
import { TelegramLoginDialog } from './telegram-login-dialog'

type OAuthProvidersProps = {
  status: SystemStatus | null
  disabled?: boolean
  className?: string
  onWeChatLogin?: () => void
  isWeChatLoading?: boolean
  redirectTo?: string
  // 注册页开启注册码校验时，返回已验证的注册码，随 OAuth state 带到后端
  getRegistrationCode?: () => string | undefined
  // 需要单独禁用的按钮 key 列表（如注册码校验下的 'wechat' / 'telegram'）
  disabledProviders?: string[]
}

type ProviderButton = {
  key: string
  label: string
  // 悬浮提示展示的提供商名称（如 GitHub / LinuxDO）
  name: string
  onClick: () => void
  icon?: ReactNode
  disabled?: boolean
}

export function OAuthProviders({
  status,
  disabled = false,
  className,
  onWeChatLogin,
  isWeChatLoading = false,
  redirectTo,
  getRegistrationCode,
  disabledProviders,
}: OAuthProvidersProps) {
  const { t } = useTranslation()
  const {
    isLoading,
    githubButtonText,
    githubButtonDisabled,
    handleGitHubLogin,
    handleDiscordLogin,
    handleOIDCLogin,
    handleLinuxDOLogin,
    handleTelegramLogin,
    handleCustomOAuthLogin,
    isTelegramDialogOpen,
    isTelegramPending,
    handleTelegramAuthorization,
    setIsTelegramDialogOpen,
  } = useOAuthLogin(status, redirectTo, getRegistrationCode)

  const providerButtons: ProviderButton[] = []

  if (status?.wechat_login && onWeChatLogin) {
    providerButtons.push({
      key: 'wechat',
      label: t('Continue with WeChat'),
      name: 'WeChat',
      onClick: onWeChatLogin,
      icon: <IconWeChat className='h-4 w-4' />,
      disabled: isWeChatLoading,
    })
  }

  if (status?.github_oauth) {
    providerButtons.push({
      key: 'github',
      label: githubButtonText || t('Continue with GitHub'),
      name: 'GitHub',
      onClick: handleGitHubLogin,
      icon: <IconGithub className='h-4 w-4' />,
      disabled: githubButtonDisabled,
    })
  }

  if (status?.discord_oauth) {
    providerButtons.push({
      key: 'discord',
      label: t('Continue with Discord'),
      name: 'Discord',
      onClick: handleDiscordLogin,
      icon: <IconDiscord className='h-4 w-4' />,
    })
  }

  if (status?.oidc_enabled) {
    const oidcDisplayName = status.oidc_display_name?.trim() || 'OIDC'
    providerButtons.push({
      key: 'oidc',
      label: t('Continue with {{name}}', {
        name: oidcDisplayName,
      }),
      name: oidcDisplayName,
      onClick: handleOIDCLogin,
    })
  }

  if (status?.linuxdo_oauth) {
    providerButtons.push({
      key: 'linuxdo',
      label: t('Continue with LinuxDO'),
      name: 'LinuxDO',
      onClick: handleLinuxDOLogin,
      icon: <IconLinuxDo className='h-4 w-4' />,
    })
  }

  if (status?.telegram_oauth) {
    providerButtons.push({
      key: 'telegram',
      label: t('Continue with Telegram'),
      name: 'Telegram',
      onClick: handleTelegramLogin,
      icon: <IconTelegram data-icon='inline-start' />,
    })
  }

  // Custom OAuth providers
  const customProviders = status?.custom_oauth_providers
  if (customProviders && customProviders.length > 0) {
    for (const provider of customProviders) {
      providerButtons.push({
        key: `custom-${provider.slug}`,
        label: t('Continue with {{name}}', { name: provider.name }),
        name: provider.name,
        onClick: () => handleCustomOAuthLogin(provider),
      })
    }
  }

  if (providerButtons.length === 0) return null

  return (
    <>
      <div className={cn('space-y-3', className)}>
        <div className='relative'>
          <div className='absolute inset-0 flex items-center'>
            <span className='w-full border-t' />
          </div>
          <div className='relative flex justify-center text-xs uppercase'>
            <span className='bg-background text-muted-foreground px-2'>
              {t('Or continue with')}
            </span>
          </div>
        </div>

        <div className='flex flex-row flex-wrap justify-center gap-2'>
          {providerButtons.map(
            ({
              key,
              name,
              onClick,
              icon,
              disabled: extraDisabled,
            }) => {
              const button = (
                <Button
                  key={key}
                  variant='outline'
                  type='button'
                  aria-label={name}
                  title={name}
                  disabled={
                    disabled ||
                    isLoading ||
                    extraDisabled ||
                    disabledProviders?.includes(key)
                  }
                  onClick={onClick}
                  className='h-11 w-11 justify-center rounded-lg p-0'
                >
                  {icon ?? <span className='text-sm font-medium'>{name.charAt(0)}</span>}
                </Button>
              )
              return (
                <Tooltip key={key}>
                  <TooltipTrigger render={button} />
                  <TooltipContent>
                    <p>{name}</p>
                  </TooltipContent>
                </Tooltip>
              )
            }
          )}
        </div>
      </div>

      <TelegramLoginDialog
        open={isTelegramDialogOpen}
        botName={status?.telegram_bot_name ?? ''}
        pending={isTelegramPending}
        onOpenChange={setIsTelegramDialogOpen}
        onAuthorization={handleTelegramAuthorization}
      />
    </>
  )
}
