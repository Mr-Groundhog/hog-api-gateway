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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Info,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
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
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { UserDetailDialog } from '@/features/users/components/dialogs/user-detail-dialog'
import type { User } from '@/features/users/types'

import {
  banTokenRiskUser,
  deleteTokenRiskEvents,
  getTokenRiskUsers,
  type TokenRiskEventType,
  type TokenRiskUserSummary,
} from '../api-token-risk'

const EVENT_LABELS: Record<TokenRiskEventType, string> = {
  concurrent_fp: 'Concurrent clients',
  single_fp_concurrency: 'Gateway-level concurrency',
  fp_burst: 'Fingerprint burst',
  fp_cross_user: 'Cross-user fingerprint',
}

// 事件类型 → 证据字段中人类可读的说明片段
const EVIDENCE_LABELS: Record<string, Record<string, string>> = {
  concurrent_fp: {
    concurrent_fingerprints: 'Distinct concurrent client fingerprints',
    threshold: 'Threshold',
  },
  single_fp_concurrency: {
    single_fp_inflight: 'In-flight requests from one fingerprint',
    threshold: 'Threshold',
  },
  fp_burst: {
    distinct_fingerprints: 'Distinct fingerprints in one day',
    valid_fingerprints: 'Fingerprints with repeated requests',
    threshold: 'Threshold',
  },
  fp_cross_user: {
    fingerprint: 'Fingerprint',
    user_ids: 'User IDs seen with this fingerprint',
    user_count: 'User count',
    threshold: 'Threshold',
  },
}

function formatTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString()
}

/** 将最新事件的证据 JSON 渲染成 "标签: 值" 的行列表，作为分发证据展示。 */
function EvidenceCell(props: { summary: TokenRiskUserSummary }) {
  const { t } = useTranslation()
  const eventType = props.summary.latest_event_type
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(props.summary.latest_evidence)
  } catch {
    parsed = {}
  }
  const labels = EVIDENCE_LABELS[eventType] ?? {}
  const rows = Object.entries(parsed).map(([key, value]) => ({
    label: labels[key] ?? key,
    value: Array.isArray(value) ? value.join(', ') : String(value),
  }))
  return (
    <div className='space-y-0.5 text-xs'>
      {rows.map((row) => (
        <div key={row.label} className='flex gap-1.5'>
          <span className='text-muted-foreground shrink-0'>
            {t(row.label)}:
          </span>
          <span className='font-medium break-all'>{row.value}</span>
        </div>
      ))}
      {rows.length === 0 && <span className='text-muted-foreground'>-</span>}
    </div>
  )
}

/** 各信号触发次数的徽标组，直观呈现分发证据的多样性。 */
function SignalBadges(props: { summary: TokenRiskUserSummary }) {
  const { t } = useTranslation()
  const signals: Array<{
    label: string
    count: number
    variant: 'destructive' | 'warning' | 'secondary'
  }> = [
    {
      label: EVENT_LABELS.concurrent_fp,
      count: props.summary.concurrent_fp_count,
      variant: 'warning',
    },
    {
      label: EVENT_LABELS.single_fp_concurrency,
      count: props.summary.single_fp_count,
      variant: 'warning',
    },
    {
      label: EVENT_LABELS.fp_burst,
      count: props.summary.fp_burst_count,
      variant: 'secondary',
    },
    {
      label: EVENT_LABELS.fp_cross_user,
      count: props.summary.fp_cross_user_count,
      variant: 'destructive',
    },
  ]
  return (
    <div className='flex max-w-full flex-wrap gap-1'>
      {signals
        .filter((signal) => signal.count > 0)
        .map((signal) => (
          <Badge key={signal.label} variant={signal.variant}>
            {t(signal.label)} ×{signal.count}
          </Badge>
        ))}
    </div>
  )
}

function PageButtons(props: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}) {
  const { t } = useTranslation()
  const totalPages = Math.max(1, Math.ceil(props.total / props.pageSize))
  return (
    <div className='flex items-center justify-end gap-2 border-t px-3 py-2'>
      <span className='text-muted-foreground mr-2 text-sm'>
        {t('Total:')} {props.total}
      </span>
      <Button
        size='icon'
        variant='outline'
        aria-label={t('Previous page')}
        disabled={props.page <= 1}
        onClick={() => props.onPageChange(props.page - 1)}
      >
        <ChevronLeft />
      </Button>
      <span className='min-w-16 text-center text-sm'>
        {props.page} / {totalPages}
      </span>
      <Button
        size='icon'
        variant='outline'
        aria-label={t('Next page')}
        disabled={props.page >= totalPages}
        onClick={() => props.onPageChange(props.page + 1)}
      >
        <ChevronRight />
      </Button>
    </div>
  )
}

export function TokenRiskTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [typeFilter, setTypeFilter] = useState<
    'all' | keyof typeof EVENT_LABELS
  >('all')
  const [userFilter, setUserFilter] = useState('')
  const [appliedUser, setAppliedUser] = useState<number | undefined>()
  const [page, setPage] = useState(1)
  const [detailUser, setDetailUser] = useState<User | null>(null)
  const [banTarget, setBanTarget] = useState<TokenRiskUserSummary | null>(null)
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(
    () => new Set()
  )
  const [deleteOpen, setDeleteOpen] = useState(false)

  const filters = {
    ...(typeFilter !== 'all' ? { event_type: typeFilter } : {}),
    ...(appliedUser !== undefined ? { user_id: appliedUser } : {}),
  }
  const query = useQuery({
    queryKey: ['token-risk', 'users', page, filters],
    queryFn: () => getTokenRiskUsers(page, 20, filters),
  })

  const banMutation = useMutation({
    mutationFn: banTokenRiskUser,
    onSuccess: () => {
      setBanTarget(null)
      toast.success(t('User banned successfully'))
      void queryClient.invalidateQueries({ queryKey: ['token-risk'] })
    },
    onError: () => toast.error(t('Failed to ban user')),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteTokenRiskEvents,
    onSuccess: (data) => {
      setDeleteOpen(false)
      setSelectedUserIds(new Set())
      toast.success(t('Deleted {{count}} risk events', { count: data.deleted }))
      void queryClient.invalidateQueries({ queryKey: ['token-risk'] })
    },
    onError: () => toast.error(t('Delete failed')),
  })

  const pageUserIds = query.data?.items.map((item) => item.user_id) ?? []
  const selectedPageCount = pageUserIds.filter((id) =>
    selectedUserIds.has(id)
  ).length

  const handleSelectionChange = (ids: number[], selected: boolean) => {
    setSelectedUserIds((current) => {
      const next = new Set(current)
      for (const id of ids) {
        if (selected) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  const handleSearch = () => {
    const trimmed = userFilter.trim()
    const parsed = Number.parseInt(trimmed, 10)
    setAppliedUser(
      trimmed !== '' && Number.isFinite(parsed) && parsed > 0
        ? parsed
        : undefined
    )
    setPage(1)
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <div className='bg-muted/20 flex flex-wrap items-end gap-3 rounded-lg border p-3'>
        <div className='flex min-w-44 flex-col gap-1.5'>
          <span className='text-sm font-medium'>{t('Event Type')}</span>
          <Select
            value={typeFilter}
            onValueChange={(value) => {
              setTypeFilter(value as 'all' | keyof typeof EVENT_LABELS)
              setPage(1)
            }}
          >
            <SelectTrigger>
              <SelectValue>
                {typeFilter === 'all' ? t('All') : t(EVENT_LABELS[typeFilter])}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>{t('All')}</SelectItem>
              {Object.entries(EVENT_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {t(label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='flex min-w-52 flex-1 flex-col gap-1.5'>
          <label htmlFor='token-risk-user' className='text-sm font-medium'>
            {t('User ID')}
          </label>
          <Input
            id='token-risk-user'
            inputMode='numeric'
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value)}
            placeholder={t('Filter by user id')}
            onKeyDown={(event) => event.key === 'Enter' && handleSearch()}
          />
        </div>
        <div className='flex gap-2'>
          <Button type='button' onClick={handleSearch}>
            <Search />
            {t('Search')}
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw
              className={query.isFetching ? 'animate-spin' : undefined}
            />
            {t('Refresh')}
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={() => {
              setTypeFilter('all')
              setUserFilter('')
              setAppliedUser(undefined)
              setPage(1)
            }}
          >
            <RotateCcw />
            {t('Reset')}
          </Button>
        </div>
      </div>
      <div className='text-muted-foreground flex items-center gap-2 text-sm'>
        <TriangleAlert className='size-4' />
        {t(
          'Detect tokens shared across multiple clients. All signals are based on request headers and behavior, not IP addresses.'
        )}
      </div>
      <div className='flex min-h-0 flex-1 flex-col rounded-lg border'>
        <div className='min-h-0 flex-1 overflow-auto'>
          <Table className='table-fixed'>
            <TableHeader>
              <TableRow>
                <TableHead className='w-10'>
                  <Checkbox
                    checked={
                      pageUserIds.length > 0 &&
                      selectedPageCount === pageUserIds.length
                    }
                    indeterminate={
                      selectedPageCount > 0 &&
                      selectedPageCount < pageUserIds.length
                    }
                    disabled={pageUserIds.length === 0}
                    onCheckedChange={(checked) =>
                      handleSelectionChange(pageUserIds, checked === true)
                    }
                    aria-label={t('Select all')}
                  />
                </TableHead>
                <TableHead className='w-32'>{t('User')}</TableHead>
                <TableHead className='w-20 text-right'>{t('Events')}</TableHead>
                <TableHead className='w-24 text-right'>
                  {t('Involved tokens')}
                </TableHead>
                <TableHead className='w-48'>
                  <span className='inline-flex items-center gap-1'>
                    {t('Distribution signals')}
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type='button'
                            aria-label={t(
                              'What do the distribution signals mean?'
                            )}
                            className='text-muted-foreground hover:text-foreground'
                          />
                        }
                      >
                        <Info className='size-3.5' />
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className='max-w-80 space-y-1.5 text-xs'>
                          <p className='font-medium'>
                            {t('Distribution signals')}
                          </p>
                          <p>
                            <span className='font-medium'>
                              {t('Concurrent clients')}:
                            </span>{' '}
                            {t(
                              'The same API key is being used by several different apps or devices at the same time.'
                            )}
                          </p>
                          <p>
                            <span className='font-medium'>
                              {t('Gateway-level concurrency')}:
                            </span>{' '}
                            {t(
                              'A single client is sending an unusually high number of simultaneous requests, typical of a reseller forwarding traffic through their own gateway.'
                            )}
                          </p>
                          <p>
                            <span className='font-medium'>
                              {t('Fingerprint burst')}:
                            </span>{' '}
                            {t(
                              'Many different clients appeared on the same key within one day, suggesting the key was shared with many people.'
                            )}
                          </p>
                          <p>
                            <span className='font-medium'>
                              {t('Cross-user fingerprint')}:
                            </span>{' '}
                            {t(
                              'The same client configuration appears on multiple different user accounts, strong evidence of reselling.'
                            )}
                          </p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </span>
                </TableHead>
                <TableHead>
                  <span className='inline-flex items-center gap-1'>
                    {t('Evidence')}
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type='button'
                            aria-label={t('How to read the evidence?')}
                            className='text-muted-foreground hover:text-foreground'
                          />
                        }
                      >
                        <Info className='size-3.5' />
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className='max-w-80 space-y-1.5 text-xs'>
                          <p className='font-medium'>
                            {t('How to read the evidence?')}
                          </p>
                          <p>
                            {t(
                              'Each line shows a measured value observed at trigger time versus the configured threshold. Only values at or above the threshold generate an event.'
                            )}
                          </p>
                          <p>
                            {t(
                              'Example: "Distinct fingerprints in one day: 15 / Threshold: 10" means 15 different clients were seen on this key in one day, well above the trigger line of 10 — the higher the value is above the threshold, the more severe the case.'
                            )}
                          </p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </span>
                </TableHead>
                <TableHead className='w-36'>{t('Last event time')}</TableHead>
                <TableHead className='w-28 text-right'>
                  {t('Actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data?.items.map((summary: TokenRiskUserSummary) => (
                <TableRow key={summary.user_id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedUserIds.has(summary.user_id)}
                      onCheckedChange={(checked) =>
                        handleSelectionChange(
                          [summary.user_id],
                          checked === true
                        )
                      }
                      aria-label={t('Select row')}
                    />
                  </TableCell>
                  <TableCell className='truncate'>
                    <button
                      type='button'
                      className='text-primary max-w-full truncate underline-offset-4 hover:underline'
                      onClick={() =>
                        setDetailUser({ id: summary.user_id } as User)
                      }
                      title={t('View user details')}
                    >
                      {summary.username || `#${summary.user_id}`}
                    </button>
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {summary.event_count}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {summary.involved_token_count}
                  </TableCell>
                  <TableCell>
                    <SignalBadges summary={summary} />
                  </TableCell>
                  <TableCell>
                    <EvidenceCell summary={summary} />
                  </TableCell>
                  <TableCell className='whitespace-nowrap tabular-nums'>
                    {formatTime(summary.latest_event_time)}
                  </TableCell>
                  <TableCell className='text-right'>
                    <Button
                      size='sm'
                      variant='destructive'
                      disabled={banMutation.isPending || summary.user_id <= 0}
                      onClick={() => setBanTarget(summary)}
                    >
                      <Ban />
                      {t('Ban user')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!query.isLoading && (query.data?.items.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={8}>
                    {t('No token risk events found.')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <PageButtons
          page={page}
          pageSize={20}
          total={query.data?.total ?? 0}
          onPageChange={setPage}
        />
      </div>
      <div className='bg-muted/20 flex items-center justify-end gap-3 rounded-lg border px-3 py-2'>
        <span className='text-muted-foreground text-sm'>
          {t('Selected {{count}}', { count: selectedUserIds.size })}
        </span>
        <Button
          type='button'
          variant='destructive'
          disabled={selectedUserIds.size === 0}
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 />
          {t('Delete records')}
        </Button>
      </div>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Delete records')}</DialogTitle>
            <DialogDescription>
              {t(
                'This will permanently delete all risk events for the {{count}} selected users. They will be removed from the suspected distribution list.',
                { count: selectedUserIds.size }
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button
              variant='destructive'
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate([...selectedUserIds])}
            >
              <Trash2 />
              {t('Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={banTarget !== null}
        onOpenChange={(open) => !open && setBanTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Ban user')}</DialogTitle>
            <DialogDescription>
              {t(
                'This will ban user {{username}} for suspected token distribution. Their tokens will stop working immediately.',
                {
                  username: banTarget?.username || `#${banTarget?.user_id}`,
                }
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setBanTarget(null)}>
              {t('Cancel')}
            </Button>
            <Button
              variant='destructive'
              disabled={banMutation.isPending}
              onClick={() => {
                if (banTarget) banMutation.mutate(banTarget.user_id)
              }}
            >
              <Ban />
              {t('Confirm ban')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <UserDetailDialog
        open={detailUser !== null}
        onOpenChange={(open) => !open && setDetailUser(null)}
        user={detailUser}
      />
    </div>
  )
}
