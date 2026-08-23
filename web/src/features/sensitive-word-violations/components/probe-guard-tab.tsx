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
import { Ban, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DatePicker } from '@/components/date-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

import {
  banProbeGuardUser,
  deleteProbeGuardLogs,
  getProbeGuardLogUsers,
  getProbeGuardLogs,
  resetProbeGuardCount,
  type ProbeGuardAction,
  type ProbeGuardFilters,
  type ProbeGuardLog,
  type ProbeGuardLogUser,
} from '../api'

const ACTION_BADGES: Record<ProbeGuardAction, { label: string; variant: 'destructive' | 'warning' | 'secondary' }> = {
  banned: { label: 'Banned', variant: 'destructive' },
  warning: { label: 'Warned', variant: 'warning' },
  dry_run: { label: 'Dry run', variant: 'secondary' },
}

function riskLevel(user: ProbeGuardLogUser): 'high' | 'medium' | 'low' {
  if (user.trigger_count >= 2) return 'high'
  if (user.trigger_count === 1) return 'medium'
  return 'low'
}

const RISK_BADGES = {
  high: { label: 'High risk', variant: 'destructive' },
  medium: { label: 'Medium risk', variant: 'warning' },
  low: { label: 'Low risk', variant: 'secondary' },
} as const

function formatTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString()
}

function parseModels(modelsJson: string): string[] {
  try {
    const parsed = JSON.parse(modelsJson)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function PageButtons(props: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void }) {
  const { t } = useTranslation()
  const totalPages = Math.max(1, Math.ceil(props.total / props.pageSize))
  return (
    <div className='flex items-center justify-end gap-2 border-t px-3 py-2'>
      <span className='text-muted-foreground mr-2 text-sm'>{t('Total:')} {props.total}</span>
      <Button size='icon' variant='outline' aria-label={t('Previous page')} disabled={props.page <= 1} onClick={() => props.onPageChange(props.page - 1)}><ChevronLeft /></Button>
      <span className='min-w-16 text-center text-sm'>{props.page} / {totalPages}</span>
      <Button size='icon' variant='outline' aria-label={t('Next page')} disabled={props.page >= totalPages} onClick={() => props.onPageChange(props.page + 1)}><ChevronRight /></Button>
    </div>
  )
}

function UserDetails(props: {
  user: ProbeGuardLogUser
  filters: ProbeGuardFilters
  selectedIds: Set<number>
  onSelectionChange: (ids: number[], selected: boolean) => void
  onReset: (id: number) => void
  onBan: (id: number) => void
}) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['probe-guard', 'user', props.user.user_id, page, props.filters],
    queryFn: () => getProbeGuardLogs(page, 20, { ...props.filters, user_id: props.user.user_id }),
  })
  const pageIds = query.data?.items.map((item) => item.id) ?? []
  const selectedPageCount = pageIds.filter((id) => props.selectedIds.has(id)).length
  return (
    <div className='bg-muted/20 border-t px-3 py-3'>
      <div className='mb-2 flex items-center justify-between gap-2'>
        <span className='text-muted-foreground text-sm'>{t('Trigger details')}</span>
        <div className='flex gap-2'>
          <Button size='sm' variant='outline' disabled={props.user.user_id <= 0} onClick={() => props.onReset(props.user.user_id)}><RotateCcw />{t('Reset count')}</Button>
          <Button size='sm' variant='destructive' disabled={props.user.user_id <= 0} onClick={() => props.onBan(props.user.user_id)}><Ban />{t('Ban user')}</Button>
        </div>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead className='w-10'><Checkbox checked={pageIds.length > 0 && selectedPageCount === pageIds.length} indeterminate={selectedPageCount > 0 && selectedPageCount < pageIds.length} disabled={pageIds.length === 0} onCheckedChange={(checked) => props.onSelectionChange(pageIds, checked === true)} aria-label={t('Select all')} /></TableHead><TableHead>{t('Time')}</TableHead><TableHead>{t('IP Address')}</TableHead><TableHead>{t('Action')}</TableHead><TableHead className='text-right'>{t('Distinct models')}</TableHead><TableHead>{t('Models tested')}</TableHead><TableHead>{t('User Agent')}</TableHead></TableRow></TableHeader>
        <TableBody>
          {query.data?.items.map((item: ProbeGuardLog) => {
            const models = parseModels(item.models_tested)
            const badge = ACTION_BADGES[item.action_taken] ?? ACTION_BADGES.warning
            return (
              <TableRow key={item.id}>
                <TableCell><Checkbox checked={props.selectedIds.has(item.id)} onCheckedChange={(checked) => props.onSelectionChange([item.id], checked === true)} aria-label={t('Select row')} /></TableCell>
                <TableCell className='whitespace-nowrap'>{formatTime(item.created_at)}</TableCell>
                <TableCell className='tabular-nums'>{item.ip || '-'}</TableCell>
                <TableCell><Badge variant={badge.variant}>{t(badge.label)}</Badge></TableCell>
                <TableCell className='text-right tabular-nums'>{item.distinct_count}</TableCell>
                <TableCell><div className='flex max-w-96 flex-wrap gap-1'>{models.length === 0 ? '-' : models.map((model) => <Badge key={model} variant='outline'>{model}</Badge>)}</div></TableCell>
                <TableCell className='max-w-48 truncate' title={item.user_agent}>{item.user_agent || '-'}</TableCell>
              </TableRow>
            )
          })}
          {!query.isLoading && (query.data?.items.length ?? 0) === 0 && <TableRow><TableCell colSpan={7}>{t('No probe guard records found.')}</TableCell></TableRow>}
        </TableBody>
      </Table>
      <PageButtons page={page} pageSize={20} total={query.data?.total ?? 0} onPageChange={setPage} />
    </div>
  )
}

export function ProbeGuardTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [userFilter, setUserFilter] = useState('')
  const [startDate, setStartDate] = useState<Date>()
  const [endDate, setEndDate] = useState<Date>()
  const [actionFilter, setActionFilter] = useState<'all' | ProbeGuardAction>('all')
  const [filters, setFilters] = useState<ProbeGuardFilters>({})
  const [page, setPage] = useState(1)
  const [expandedUser, setExpandedUser] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [deleteOpen, setDeleteOpen] = useState<false | 'selected' | 'dry-run'>(false)
  const query = useQuery({ queryKey: ['probe-guard', 'users', page, filters], queryFn: () => getProbeGuardLogUsers(page, 20, filters) })

  const handleSearch = () => {
    const next: ProbeGuardFilters = {}
    if (userFilter.trim()) next.user = userFilter.trim()
    if (startDate) { const date = new Date(startDate); date.setHours(0, 0, 0, 0); next.start_time = Math.floor(date.getTime() / 1000) }
    if (endDate) { const date = new Date(endDate); date.setHours(23, 59, 59, 999); next.end_time = Math.floor(date.getTime() / 1000) }
    if (actionFilter !== 'all') next.action = actionFilter
    setPage(1)
    setExpandedUser(null)
    setFilters(next)
  }

  const resetMutation = useMutation({ mutationFn: resetProbeGuardCount, onSuccess: () => { toast.success(t('Reset completed')); void queryClient.invalidateQueries({ queryKey: ['probe-guard'] }) }, onError: () => toast.error(t('Reset failed')) })
  const banMutation = useMutation({ mutationFn: banProbeGuardUser, onSuccess: () => { toast.success(t('User banned successfully')); void queryClient.invalidateQueries({ queryKey: ['probe-guard'] }) }, onError: () => toast.error(t('Failed to ban user')) })
  const deleteMutation = useMutation({ mutationFn: deleteProbeGuardLogs, onSuccess: (data) => { setDeleteOpen(false); setSelectedIds(new Set()); toast.success(t('Deleted {{count}} violation records', { count: data.deleted })); void queryClient.invalidateQueries({ queryKey: ['probe-guard'] }) }, onError: () => toast.error(t('Delete failed')) })

  const handleSelectionChange = (ids: number[], selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const id of ids) {
        if (selected) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <div className='bg-muted/20 flex flex-wrap items-end gap-3 rounded-lg border p-3'>
        <div className='flex min-w-52 flex-1 flex-col gap-1.5'><label htmlFor='probe-guard-user' className='text-sm font-medium'>{t('User')}</label><Input id='probe-guard-user' value={userFilter} onChange={(event) => setUserFilter(event.target.value)} placeholder={t('Filter by username')} onKeyDown={(event) => event.key === 'Enter' && handleSearch()} /></div>
        <div className='flex min-w-44 flex-col gap-1.5'><span className='text-sm font-medium'>{t('Start Time')}</span><DatePicker selected={startDate} onSelect={setStartDate} /></div>
        <div className='flex min-w-44 flex-col gap-1.5'><span className='text-sm font-medium'>{t('End Time')}</span><DatePicker selected={endDate} onSelect={setEndDate} /></div>
        <div className='flex min-w-40 flex-col gap-1.5'><span className='text-sm font-medium'>{t('Filter')}</span><Select value={actionFilter} onValueChange={(value) => setActionFilter(value as 'all' | ProbeGuardAction)}><SelectTrigger><SelectValue>{actionFilter === 'all' ? t('All') : t(ACTION_BADGES[actionFilter].label)}</SelectValue></SelectTrigger><SelectContent><SelectItem value='all'>{t('All')}</SelectItem><SelectItem value='warning'>{t(ACTION_BADGES.warning.label)}</SelectItem><SelectItem value='banned'>{t(ACTION_BADGES.banned.label)}</SelectItem><SelectItem value='dry_run'>{t(ACTION_BADGES.dry_run.label)}</SelectItem></SelectContent></Select></div>
        <div className='flex gap-2'><Button type='button' onClick={handleSearch}><Search />{t('Search')}</Button><Button type='button' variant='outline' onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw className={query.isFetching ? 'animate-spin' : undefined} />{t('Refresh')}</Button><Button type='button' variant='outline' onClick={() => { setUserFilter(''); setStartDate(undefined); setEndDate(undefined); setActionFilter('all'); setFilters({}); setPage(1) }}><RotateCcw />{t('Reset')}</Button></div>
      </div>
      <div className='text-muted-foreground flex items-center gap-2 text-sm'>{t('Track accounts that repeatedly probe key validity.')}</div>
      <div className='min-h-0 flex-1 overflow-auto rounded-lg border'>
        <Table className='table-fixed'><TableHeader><TableRow><TableHead>{t('User')}</TableHead><TableHead className='w-16 text-right'>{t('Probe Count')}</TableHead><TableHead>{t('Models tested')}</TableHead><TableHead className='w-32'>{t('IP Address')}</TableHead><TableHead className='w-40'>{t('Last Probe Time')}</TableHead></TableRow></TableHeader><TableBody>
          {query.data?.items.map((user) => {
            const isExpanded = expandedUser === user.user_id
            const badge = RISK_BADGES[riskLevel(user)]
            const latestModels = parseModels(user.latest_models ?? '[]')
            const overflowCount = Math.max(0, latestModels.length - 4)
            return (
              <Fragment key={`${user.user_id}-${user.username}`}>
                <TableRow>
                  <TableCell colSpan={5} className='p-0'>
                    <button
                      type='button'
                      aria-expanded={isExpanded}
                      className='hover:bg-muted/50 grid w-full grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)_8rem_10rem] items-center gap-4 px-3 py-3 text-left'
                      onClick={() => setExpandedUser(isExpanded ? null : user.user_id)}
                    >
                      <span className='flex min-w-0 items-center gap-3 font-medium'><ChevronDown className={`size-4 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} /><span className='truncate'>{user.username || `#${user.user_id}`}</span><Badge variant={badge.variant}>{t(badge.label)}</Badge></span>
                      <span className='text-muted-foreground text-right tabular-nums'>{user.trigger_count}</span>
                      <span className='flex min-w-0 flex-wrap gap-1'>{latestModels.length === 0 ? '-' : (<>
                        {latestModels.slice(0, 4).map((model) => <Badge key={model} variant='outline' className='max-w-40 truncate'>{model}</Badge>)}
                        {overflowCount > 0 && <Badge variant='outline'>+{overflowCount}</Badge>}
                      </>)}</span>
                      <span className='text-muted-foreground truncate tabular-nums'>{user.latest_ip || '-'}</span>
                      <span className='text-muted-foreground truncate whitespace-nowrap text-sm tabular-nums'>{user.latest_created_at > 0 ? formatTime(user.latest_created_at) : '-'}</span>
                    </button>
                  </TableCell>
                </TableRow>
                {isExpanded && <TableRow><TableCell colSpan={5} className='p-0'><UserDetails user={user} filters={filters} selectedIds={selectedIds} onSelectionChange={handleSelectionChange} onReset={(id) => resetMutation.mutate(id)} onBan={(id) => banMutation.mutate(id)} /></TableCell></TableRow>}
              </Fragment>
            )
          })}
          {!query.isLoading && (query.data?.items.length ?? 0) === 0 && <TableRow><TableCell colSpan={5}>{t('No probe guard records found.')}</TableCell></TableRow>}
        </TableBody></Table>
        <PageButtons page={page} pageSize={20} total={query.data?.total ?? 0} onPageChange={(next) => { setPage(next); setExpandedUser(null) }} />
      </div>
      <div className='flex items-center justify-end gap-3 rounded-lg border bg-muted/20 px-3 py-2'>
        <span className='text-muted-foreground text-sm'>{t('Selected {{count}}', { count: selectedIds.size })}</span>
        <Button type='button' variant='outline' disabled={deleteMutation.isPending} onClick={() => setDeleteOpen('dry-run')}><Trash2 />{t('Clear dry-run records')}</Button>
        <Button type='button' variant='destructive' disabled={selectedIds.size === 0} onClick={() => setDeleteOpen('selected')}><Trash2 />{t('Delete records')}</Button>
      </div>
      <Dialog open={deleteOpen !== false} onOpenChange={(open) => setDeleteOpen(open ? deleteOpen : false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('Delete records')}</DialogTitle><DialogDescription>{t('This will permanently delete the selected records.')}{deleteOpen === 'selected' ? ` ${t('Selected {{count}}', { count: selectedIds.size })}` : ` ${t('All dry-run (observation mode) records will be removed.')}`}</DialogDescription></DialogHeader>
          <DialogFooter><Button variant='outline' onClick={() => setDeleteOpen(false)}>{t('Cancel')}</Button><Button variant='destructive' disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(deleteOpen === 'selected' ? { ids: [...selectedIds] } : { action: 'dry_run' })}><Trash2 />{t('Delete')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
