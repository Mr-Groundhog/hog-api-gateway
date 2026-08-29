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
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { BadgeCell, TruncatedCell } from '@/components/data-table'
import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { getApiKey, updateApiKey } from '../api'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import type { ApiKey } from '../types'
import type { ApiKeyGroupOption } from './api-key-group-combobox'
import { useApiKeys } from './api-keys-provider'
import {
  AUTO_GROUP_FRAME_CLASS_NAME,
  AutoGroupFlowBorder,
  GroupRatioBadge,
  type GroupRatio,
} from './auto-group-visuals'

type ApiKeyGroupCellProps = {
  apiKey: ApiKey
  groupOptions: ApiKeyGroupOption[]
  ratio?: GroupRatio
  shouldReduceMotion: boolean
}

export function ApiKeyGroupCell(props: ApiKeyGroupCellProps) {
  const { t } = useTranslation()
  const { triggerRefresh } = useApiKeys()
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  const group = props.apiKey.group || ''
  const isAuto = group === 'auto'
  const canSwitch = props.groupOptions.length > 0
  const ratio = typeof props.ratio === 'number' ? props.ratio : undefined

  const filteredOptions = useMemo(() => {
    const search = searchValue.trim().toLowerCase()
    if (!search) return props.groupOptions

    return props.groupOptions.filter((option) => {
      const ratioText = String(option.ratio ?? '').toLowerCase()
      return (
        option.value.toLowerCase().includes(search) ||
        option.label.toLowerCase().includes(search) ||
        option.desc?.toLowerCase().includes(search) ||
        ratioText.includes(search)
      )
    })
  }, [props.groupOptions, searchValue])

  // 与编辑抽屉的保存流程保持一致：先取该令牌的最新数据，只替换分组后整体提交，
  // 避免直接用列表行的旧快照覆盖remain_quota等字段。
  const handleGroupChange = async (nextGroup: string) => {
    setOpen(false)
    setSearchValue('')
    if (nextGroup === group || isUpdating) return

    setIsUpdating(true)
    try {
      const res = await getApiKey(props.apiKey.id)
      if (!res.success || !res.data) {
        toast.error(res.message || t(ERROR_MESSAGES.UPDATE_FAILED))
        return
      }
      const fresh = res.data
      const result = await updateApiKey({
        id: fresh.id,
        name: fresh.name,
        remain_quota: fresh.remain_quota,
        expired_time: fresh.expired_time,
        unlimited_quota: fresh.unlimited_quota,
        model_limits_enabled: fresh.model_limits_enabled,
        model_limits: fresh.model_limits || '',
        allow_ips: fresh.allow_ips || '',
        group: nextGroup,
        auto_groups: [],
        cross_group_retry: nextGroup === 'auto',
      })
      if (result.success) {
        toast.success(t(SUCCESS_MESSAGES.API_KEY_UPDATED))
        triggerRefresh()
      } else {
        toast.error(result.message || t(ERROR_MESSAGES.UPDATE_FAILED))
      }
    } catch {
      toast.error(t(ERROR_MESSAGES.UNEXPECTED))
    } finally {
      setIsUpdating(false)
    }
  }

  if (!canSwitch) {
    if (!isAuto) {
      return (
        <TruncatedCell
          className='-ml-1.5'
          tooltipContent={group || '-'}
          tooltipClassName='break-all'
        >
          <GroupBadge group={group} ratio={ratio} />
        </TruncatedCell>
      )
    }

    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <BadgeCell
              data-api-key-group-cell='auto'
              className='gap-1.5 overflow-visible text-xs'
            />
          }
        >
          <StatusBadge
            label={t('Cross-group')}
            variant='info'
            copyable={false}
          />
          <GroupRatioBadge
            ratio={props.ratio}
            isAuto
            shouldReduceMotion={props.shouldReduceMotion}
          />
        </TooltipTrigger>
        <TooltipContent>
          <span className='text-xs'>
            {t(
              'Automatically selects the best available group with circuit breaker mechanism'
            )}
          </span>
        </TooltipContent>
      </Tooltip>
    )
  }

  const triggerClassName = cn(
    '-ml-1.5 flex max-w-full min-w-0 items-center rounded-md py-0.5 pr-1 text-xs outline-none transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-60',
    isAuto ? 'gap-1.5 overflow-visible' : 'gap-1'
  )

  const chevron = isUpdating ? (
    <Loader2
      aria-hidden='true'
      className='text-muted-foreground size-3.5 shrink-0 animate-spin'
    />
  ) : (
    <ChevronDown
      aria-hidden='true'
      className='text-muted-foreground size-3.5 shrink-0'
    />
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type='button'
            data-api-key-group-cell={isAuto ? 'auto' : undefined}
            title={
              isAuto
                ? t(
                    'Automatically selects the best available group with circuit breaker mechanism'
                  )
                : group
            }
            aria-label={t('Switch group')}
            disabled={isUpdating}
            onClick={(event) => event.stopPropagation()}
            className={triggerClassName}
          />
        }
      >
        {isAuto ? (
          <>
            <StatusBadge
              label={t('Cross-group')}
              variant='info'
              copyable={false}
            />
            <GroupRatioBadge
              ratio={props.ratio}
              isAuto
              shouldReduceMotion={props.shouldReduceMotion}
            />
          </>
        ) : (
          <GroupBadge group={group} ratio={ratio} />
        )}
        {chevron}
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='w-72 overflow-hidden rounded-xl p-0 shadow-lg'
        onWheel={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t('Search...')}
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList className='max-h-[280px]'>
            <CommandEmpty>{t('No group found.')}</CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => {
                const isAutoOption = option.value === 'auto'

                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    data-auto-group-effect={isAutoOption ? 'option' : undefined}
                    onSelect={() => void handleGroupChange(option.value)}
                    className={cn(
                      'data-[selected=true]:bg-muted items-start gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors',
                      isAutoOption &&
                        cn(
                          AUTO_GROUP_FRAME_CLASS_NAME,
                          'border-primary/35 data-[selected=true]:border-primary/55'
                        )
                    )}
                  >
                    {isAutoOption && (
                      <AutoGroupFlowBorder
                        shouldReduceMotion={props.shouldReduceMotion}
                      />
                    )}
                    <Check
                      aria-hidden='true'
                      className={cn(
                        'mt-0.5 size-3.5 shrink-0',
                        group === option.value ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className='min-w-0 flex-1'>
                      <span className='block truncate font-medium'>
                        {option.label}
                      </span>
                      {option.desc && (
                        <span className='text-muted-foreground block truncate text-[11px]'>
                          {option.desc}
                        </span>
                      )}
                    </span>
                    <GroupRatioBadge
                      ratio={option.ratio}
                      isAuto={isAutoOption}
                      shouldReduceMotion={props.shouldReduceMotion}
                    />
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
