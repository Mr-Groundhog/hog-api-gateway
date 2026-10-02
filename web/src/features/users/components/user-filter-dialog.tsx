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
import { useState } from 'react'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatQuota } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import dayjs from '@/lib/dayjs'
import { ROLE } from '@/lib/roles'
import { AuthOperationError } from '@/lib/secure-verification'
import { useAuthStore } from '@/stores/auth-store'

import { banUsersByIds, filterUsers } from '../api'
import {
  BATCH_FAILURE_REASON_KEYS,
  ERROR_MESSAGES,
  USER_ROLES,
  USER_STATUSES,
} from '../constants'
import type {
  BatchQuotaResponse,
  UserBatchFailure,
  UserFilterItem,
} from '../types'
import { BanReasonDialog } from './ban-reason-dialog'
import { UserBatchQuotaDialog } from './user-batch-quota-dialog'
import { useUsers } from './users-provider'

const DAY_SECONDS = 86400
const PRESET_DAYS = [15, 30]
const PAGE_SIZE = 20

// 单个活跃度条件的状态；阈值可以是预设天数或自定义时间点。
type ActivityCondition = {
  enabled: boolean
  days: number
  useCustom: boolean
  customTime: string
}

const emptyCondition = (): ActivityCondition => ({
  enabled: false,
  days: 30,
  useCustom: false,
  customTime: '',
})

// conditionBefore 把条件换算为 Unix 秒；自定义时间不合法时返回 null。
const conditionBefore = (condition: ActivityCondition): number | null => {
  if (!condition.enabled) return null
  if (condition.useCustom) {
    const ms = new Date(condition.customTime).getTime()
    if (!Number.isFinite(ms)) return null
    return Math.floor(ms / 1000)
  }
  return Math.floor(Date.now() / 1000) - condition.days * DAY_SECONDS
}

type FilterSummary =
  | { kind: 'ban'; succeeded: number; failed: UserBatchFailure[] }
  | { kind: 'quota'; succeeded: number; failed: UserBatchFailure[] }

export function UserFilterDialog() {
  const { t } = useTranslation()
  const {
    open,
    setOpen,
    triggerRefresh,
    requestVerification,
    verificationActive,
  } = useUsers()
  const isRootOperator = useAuthStore(
    (state) => state.auth.user?.role === ROLE.SUPER_ADMIN
  )

  const [lastLogin, setLastLogin] = useState<ActivityCondition>(emptyCondition)
  const [lastCall, setLastCall] = useState<ActivityCondition>(emptyCondition)
  const [phase, setPhase] = useState<'conditions' | 'results'>('conditions')
  const [applied, setApplied] = useState<{
    last_login_before?: number
    last_call_before?: number
  } | null>(null)
  const [items, setItems] = useState<UserFilterItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [banDialogOpen, setBanDialogOpen] = useState(false)
  const [quotaDialogOpen, setQuotaDialogOpen] = useState(false)
  const [summary, setSummary] = useState<FilterSummary | null>(null)

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageIds = items.map((item) => item.id)
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id))
  const somePageSelected = pageIds.some((id) => selectedIds.has(id))
  const hasCallCondition = applied?.last_call_before !== undefined

  const loadPreview = async (
    condition: NonNullable<typeof applied>,
    targetPage: number
  ) => {
    setLoading(true)
    try {
      const result = await filterUsers({
        ...condition,
        page: targetPage,
        page_size: PAGE_SIZE,
      })
      if (result.success && result.data) {
        setItems(result.data.items ?? [])
        setTotal(result.data.total)
        setPage(result.data.page ?? targetPage)
      } else {
        handleServerError(result, t(ERROR_MESSAGES.UNEXPECTED))
      }
    } catch (error) {
      handleServerError(
        AuthOperationError.from(error),
        t(ERROR_MESSAGES.UNEXPECTED)
      )
    } finally {
      setLoading(false)
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (next) return
    setOpen(null)
    setPhase('conditions')
    setLastLogin(emptyCondition())
    setLastCall(emptyCondition())
    setApplied(null)
    setItems([])
    setTotal(0)
    setPage(1)
    setSelectedIds(new Set())
    setSummary(null)
  }

  const canPreview = () => {
    if (!lastLogin.enabled && !lastCall.enabled) return false
    if (lastLogin.enabled && conditionBefore(lastLogin) === null) return false
    if (lastCall.enabled && conditionBefore(lastCall) === null) return false
    return true
  }

  const handlePreview = async () => {
    if (!canPreview()) return
    const condition: { last_login_before?: number; last_call_before?: number } =
      {}
    const loginBefore = conditionBefore(lastLogin)
    if (loginBefore !== null) condition.last_login_before = loginBefore
    const callBefore = conditionBefore(lastCall)
    if (callBefore !== null) condition.last_call_before = callBefore
    setApplied(condition)
    setSelectedIds(new Set())
    setSummary(null)
    setPhase('results')
    await loadPreview(condition, 1)
  }

  const toggleRow = (id: number) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const togglePage = (selected: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      for (const id of pageIds) {
        if (selected) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  // 「选择全部结果」一律通过 ids_only 预览拉取显式 ID（上限 1000）。
  const handleSelectAllResults = async () => {
    if (!applied) return
    setLoading(true)
    try {
      const result = await filterUsers({ ...applied, ids_only: true })
      if (result.success && result.data) {
        const ids = result.data.ids ?? []
        setSelectedIds(new Set(ids))
        if (result.data.truncated) {
          toast.warning(
            t('Only the first {{count}} users can be selected at once', {
              count: ids.length,
            })
          )
        }
      } else {
        handleServerError(result, t(ERROR_MESSAGES.UNEXPECTED))
      }
    } catch (error) {
      handleServerError(
        AuthOperationError.from(error),
        t(ERROR_MESSAGES.UNEXPECTED)
      )
    } finally {
      setLoading(false)
    }
  }

  const handleBan = async (reason: string) => {
    const ids = [...selectedIds]
    try {
      // 超级管理员免二次验证（服务端同样按 root 会话豁免）。
      let proofToken = ''
      if (!isRootOperator) {
        const proof = await requestVerification({
          scope: 'admin.user.ban_by_ids',
          context: { ids },
          title: t('Verify to ban selected users'),
          description: t(
            'Confirm your identity before banning the selected users.'
          ),
        })
        if (!proof) return
        proofToken = proof.proof_token
      }
      const result = await banUsersByIds(
        { ids, ban_reason: reason },
        proofToken
      )
      if (result.success && result.data) {
        setBanDialogOpen(false)
        setSummary({
          kind: 'ban',
          succeeded: result.data.banned,
          failed: result.data.failed,
        })
        setSelectedIds(new Set())
        toast.success(
          t('{{count}} user(s) banned', { count: result.data.banned })
        )
        triggerRefresh()
        if (applied) await loadPreview(applied, page)
      } else {
        handleServerError(result, t(ERROR_MESSAGES.UNEXPECTED))
      }
    } catch (error) {
      handleServerError(
        AuthOperationError.from(error),
        t(ERROR_MESSAGES.UNEXPECTED)
      )
    }
  }

  const handleQuotaSuccess = (result: BatchQuotaResponse) => {
    setSummary({
      kind: 'quota',
      succeeded: result.succeeded,
      failed: result.failed,
    })
    setSelectedIds(new Set())
    toast.success(
      t('{{count}} user(s) updated', { count: result.succeeded })
    )
    triggerRefresh()
    if (applied) void loadPreview(applied, page)
  }

  const renderCondition = (
    label: string,
    condition: ActivityCondition,
    onChange: (next: ActivityCondition) => void
  ) => (
    <div className='flex flex-col gap-2 rounded-lg border p-3'>
      <label className='flex items-center gap-2 text-sm font-medium'>
        <Checkbox
          checked={condition.enabled}
          onCheckedChange={(value) =>
            onChange({ ...condition, enabled: Boolean(value) })
          }
          aria-label={label}
        />
        {label}
      </label>
      {condition.enabled && (
        <div className='flex flex-col gap-2'>
          <div className='flex flex-wrap gap-2'>
            {PRESET_DAYS.map((days) => (
              <Button
                key={days}
                type='button'
                size='sm'
                variant={
                  !condition.useCustom && condition.days === days
                    ? 'default'
                    : 'outline'
                }
                onClick={() =>
                  onChange({ ...condition, useCustom: false, days })
                }
              >
                {t('{{days}} days ago', { days })}
              </Button>
            ))}
            <Button
              type='button'
              size='sm'
              variant={condition.useCustom ? 'default' : 'outline'}
              onClick={() => onChange({ ...condition, useCustom: true })}
            >
              {t('Custom time')}
            </Button>
          </div>
          {condition.useCustom && (
            <input
              type='datetime-local'
              className='border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:ring-3'
              value={condition.customTime}
              onChange={(event) =>
                onChange({ ...condition, customTime: event.target.value })
              }
            />
          )}
        </div>
      )}
    </div>
  )

  const renderFailureList = (failed: UserBatchFailure[]) => {
    if (failed.length === 0) return null
    return (
      <ul className='mt-1 max-h-24 list-inside list-disc overflow-y-auto text-xs'>
        {failed.map((failure) => (
          <li key={failure.id}>
            {t('User ID')}: {failure.id} —{' '}
            {t(
              BATCH_FAILURE_REASON_KEYS[failure.reason] ??
                'Operation failed, please retry'
            )}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <>
      <Dialog
        open={open === 'filter_users' && !verificationActive}
        onOpenChange={handleOpenChange}
      >
        <DialogContent className='sm:max-w-4xl'>
          <DialogHeader>
            <DialogTitle>{t('Filter Users')}</DialogTitle>
            <DialogDescription>
              {phase === 'conditions'
                ? t(
                    'Choose the activity conditions to find matching users. This preview never changes any account.'
                  )
                : t('{{count}} user(s) matched the selected conditions', {
                    count: total,
                  })}
            </DialogDescription>
          </DialogHeader>

          {phase === 'conditions' ? (
            <div className='flex flex-col gap-3 py-2'>
              {renderCondition(
                t('Last login time'),
                lastLogin,
                setLastLogin
              )}
              {renderCondition(
                t('Last API call time'),
                lastCall,
                setLastCall
              )}
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Selecting both conditions only matches users that satisfy both of them.'
                )}
              </p>
            </div>
          ) : (
            <div className='flex flex-col gap-3 py-2'>
              {summary && (
                <div className='bg-muted rounded-lg p-3 text-sm'>
                  <div>
                    {summary.kind === 'ban'
                      ? t('{{count}} user(s) banned', {
                          count: summary.succeeded,
                        })
                      : t('{{count}} user(s) updated', {
                          count: summary.succeeded,
                        })}
                    {' · '}
                    {t('{{count}} failed', { count: summary.failed.length })}
                  </div>
                  {renderFailureList(summary.failed)}
                </div>
              )}

              <div className='flex flex-wrap items-center justify-between gap-2'>
                <div className='text-muted-foreground text-sm'>
                  {t('{{count}} selected', { count: selectedIds.size })}
                </div>
                <div className='flex gap-2'>
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    disabled={loading || total === 0}
                    onClick={handleSelectAllResults}
                  >
                    {t('Select all results (up to 1000)')}
                  </Button>
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    onClick={() => {
                      setSelectedIds(new Set())
                      setPhase('conditions')
                    }}
                  >
                    {t('Back to conditions')}
                  </Button>
                </div>
              </div>

              <div className='max-h-80 overflow-y-auto rounded-lg border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className='w-10'>
                        <Checkbox
                          checked={allPageSelected}
                          indeterminate={
                            !allPageSelected && somePageSelected
                          }
                          onCheckedChange={(value) =>
                            togglePage(Boolean(value))
                          }
                          aria-label={t('Select all')}
                        />
                      </TableHead>
                      <TableHead>{t('ID')}</TableHead>
                      <TableHead>{t('Username')}</TableHead>
                      <TableHead>{t('Status')}</TableHead>
                      <TableHead>{t('Role')}</TableHead>
                      <TableHead>{t('Quota')}</TableHead>
                      <TableHead>{t('Last login time')}</TableHead>
                      {hasCallCondition && (
                        <TableHead>{t('Last API call time')}</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={hasCallCondition ? 8 : 7}
                          className='text-muted-foreground h-24 text-center'
                        >
                          {loading ? t('Loading...') : t('No users matched')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.has(item.id)}
                              onCheckedChange={() => toggleRow(item.id)}
                              aria-label={t('Select row')}
                            />
                          </TableCell>
                          <TableCell>{item.id}</TableCell>
                          <TableCell className='font-medium'>
                            {item.username}
                          </TableCell>
                          <TableCell>
                            {t(
                              USER_STATUSES[
                                item.status as keyof typeof USER_STATUSES
                              ]?.labelKey ?? 'Unknown'
                            )}
                          </TableCell>
                          <TableCell>
                            {t(
                              USER_ROLES[item.role as keyof typeof USER_ROLES]
                                ?.labelKey ?? 'Unknown'
                            )}
                          </TableCell>
                          <TableCell>{formatQuota(item.quota)}</TableCell>
                          <TableCell>
                            {item.last_login_at
                              ? dayjs
                                  .unix(item.last_login_at)
                                  .format('YYYY-MM-DD HH:mm')
                              : t('Never')}
                          </TableCell>
                          {hasCallCondition && (
                            <TableCell>
                              {item.last_call_at
                                ? dayjs
                                    .unix(item.last_call_at)
                                    .format('YYYY-MM-DD HH:mm')
                                : t('Never')}
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {pageCount > 1 && (
                <div className='flex items-center justify-end gap-2 text-sm'>
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    disabled={loading || page <= 1}
                    onClick={() => applied && loadPreview(applied, page - 1)}
                  >
                    {t('Previous')}
                  </Button>
                  <span className='text-muted-foreground'>
                    {page} / {pageCount}
                  </span>
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    disabled={loading || page >= pageCount}
                    onClick={() => applied && loadPreview(applied, page + 1)}
                  >
                    {t('Next')}
                  </Button>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {phase === 'conditions' ? (
              <>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => handleOpenChange(false)}
                >
                  {t('Cancel')}
                </Button>
                <Button
                  type='button'
                  disabled={loading || !canPreview()}
                  onClick={handlePreview}
                >
                  {loading ? t('Loading...') : t('Preview matching users')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type='button'
                  variant='outline'
                  disabled={selectedIds.size === 0}
                  onClick={() => setBanDialogOpen(true)}
                >
                  {t('Ban selected users')}
                </Button>
                <Button
                  type='button'
                  disabled={selectedIds.size === 0}
                  onClick={() => setQuotaDialogOpen(true)}
                >
                  {t('Adjust quota')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BanReasonDialog
        open={banDialogOpen}
        onOpenChange={setBanDialogOpen}
        username={t('{{count}} selected user(s)', {
          count: selectedIds.size,
        })}
        onConfirm={handleBan}
      />

      <UserBatchQuotaDialog
        open={quotaDialogOpen}
        onOpenChange={setQuotaDialogOpen}
        ids={[...selectedIds]}
        onSuccess={handleQuotaSuccess}
      />
    </>
  )
}
