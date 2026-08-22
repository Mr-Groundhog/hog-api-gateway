import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, RotateCcw, Search, ShieldAlert, Trash2 } from 'lucide-react'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DatePicker } from '@/components/date-picker'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

import {
  banSensitiveWordViolationUser,
  deleteSensitiveWordViolations,
  getSensitiveWordViolationUsers,
  getSensitiveWordViolations,
  resetSensitiveWordViolationCount,
  type SensitiveWordViolation,
  type SensitiveWordViolationFilters,
  type SensitiveWordViolationUser,
} from './api'

function formatTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString()
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

function UserDetails(props: { user: SensitiveWordViolationUser; filters: SensitiveWordViolationFilters; selectedIds: Set<number>; onSelectionChange: (ids: number[], selected: boolean) => void; onReset: (id: number) => void; onBan: (id: number) => void }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<SensitiveWordViolation | null>(null)
  const query = useQuery({
    queryKey: ['sensitive-word-violations', 'user', props.user.user_id, page, props.filters],
    queryFn: () => getSensitiveWordViolations(page, 20, { ...props.filters, user_id: props.user.user_id }),
  })
  const pageIds = query.data?.items.map((item) => item.id) ?? []
  const selectedPageCount = pageIds.filter((id) => props.selectedIds.has(id)).length
  return (
    <div className='bg-muted/20 border-t px-3 py-3'>
      <div className='mb-2 flex items-center justify-between gap-2'>
        <span className='text-muted-foreground text-sm'>{t('Violation details')}</span>
        <div className='flex gap-2'>
          <Button size='sm' variant='outline' disabled={props.user.user_id <= 0} onClick={() => props.onReset(props.user.user_id)}><RotateCcw />{t('Reset count')}</Button>
          <Button size='sm' variant='destructive' disabled={props.user.user_id <= 0} onClick={() => props.onBan(props.user.user_id)}><Ban />{t('Ban user')}</Button>
        </div>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead className='w-10'><Checkbox checked={pageIds.length > 0 && selectedPageCount === pageIds.length} indeterminate={selectedPageCount > 0 && selectedPageCount < pageIds.length} disabled={pageIds.length === 0} onCheckedChange={(checked) => props.onSelectionChange(pageIds, checked === true)} aria-label={t('Select all')} /></TableHead><TableHead>{t('Time')}</TableHead><TableHead>{t('User Agent')}</TableHead><TableHead>{t('Request Content')}</TableHead><TableHead>{t('Matched Words')}</TableHead></TableRow></TableHeader>
        <TableBody>
          {query.data?.items.map((item) => (
            <TableRow key={item.id}>
              <TableCell><Checkbox checked={props.selectedIds.has(item.id)} onCheckedChange={(checked) => props.onSelectionChange([item.id], checked === true)} aria-label={t('Select row')} /></TableCell>
              <TableCell>{formatTime(item.created_at)}</TableCell>
              <TableCell className='max-w-96 truncate' title={item.user_agent}>{item.user_agent || '-'}</TableCell>
              <TableCell><button type='button' className='text-primary block max-w-96 truncate text-left underline-offset-4 hover:underline' onClick={() => setSelected(item)} title={item.request_content}>{item.request_content || '-'}</button></TableCell>
              <TableCell>{item.matched_words || '-'}</TableCell>
            </TableRow>
          ))}
          {!query.isLoading && (query.data?.items.length ?? 0) === 0 && <TableRow><TableCell colSpan={5}>{t('No sensitive-word violations found.')}</TableCell></TableRow>}
        </TableBody>
      </Table>
      <PageButtons page={page} pageSize={20} total={query.data?.total ?? 0} onPageChange={setPage} />
      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('Request Content')}</DialogTitle><DialogDescription>{selected && `${formatTime(selected.created_at)} · ${selected.request_path}`}</DialogDescription></DialogHeader>
          {selected && <pre className='max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded border p-3 text-xs'>{selected.request_content || '-'}</pre>}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function SensitiveWordViolations() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [userFilter, setUserFilter] = useState('')
  const [startDate, setStartDate] = useState<Date>()
  const [endDate, setEndDate] = useState<Date>()
  const [highlightedOnly, setHighlightedOnly] = useState(false)
  const [filters, setFilters] = useState<SensitiveWordViolationFilters>({})
  const [page, setPage] = useState(1)
  const [expandedUser, setExpandedUser] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePreset, setDeletePreset] = useState('1')
  const [deleteDate, setDeleteDate] = useState<Date>()
  const query = useQuery({ queryKey: ['sensitive-word-violations', 'users', page, filters], queryFn: () => getSensitiveWordViolationUsers(page, 20, filters) })

  const handleSearch = () => {
    const next: SensitiveWordViolationFilters = {}
    if (userFilter.trim()) next.user = userFilter.trim()
    if (startDate) { const date = new Date(startDate); date.setHours(0, 0, 0, 0); next.start_time = Math.floor(date.getTime() / 1000) }
    if (endDate) { const date = new Date(endDate); date.setHours(23, 59, 59, 999); next.end_time = Math.floor(date.getTime() / 1000) }
    if (highlightedOnly) next.highlighted = true
    setPage(1)
    setExpandedUser(null)
    setFilters(next)
  }

  const resetMutation = useMutation({ mutationFn: resetSensitiveWordViolationCount, onSuccess: () => { toast.success(t('Reset completed')); void queryClient.invalidateQueries({ queryKey: ['sensitive-word-violations'] }) }, onError: () => toast.error(t('Reset failed')) })
  const banMutation = useMutation({ mutationFn: banSensitiveWordViolationUser, onSuccess: () => { toast.success(t('User banned successfully')); void queryClient.invalidateQueries({ queryKey: ['sensitive-word-violations'] }) }, onError: () => toast.error(t('Failed to ban user')) })
  const deleteMutation = useMutation({ mutationFn: deleteSensitiveWordViolations, onSuccess: (data) => { setDeleteOpen(false); setSelectedIds(new Set()); toast.success(t('Deleted {{count}} violation records', { count: data.deleted })); void queryClient.invalidateQueries({ queryKey: ['sensitive-word-violations'] }) }, onError: () => toast.error(t('Delete failed')) })
  const selectedDays = deletePreset === 'custom' ? undefined : Number(deletePreset)
  const selectedBeforeTime = deletePreset === 'custom' && deleteDate ? Math.floor(new Date(deleteDate).setHours(0, 0, 0, 0) / 1000) : undefined
  const canDelete = selectedIds.size > 0 && (deletePreset === 'custom' ? selectedBeforeTime !== undefined : Number.isInteger(selectedDays))

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
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Sensitive Word Triggers')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 flex-col gap-3'>
          <div className='bg-muted/20 flex flex-wrap items-end gap-3 rounded-lg border p-3'>
            <div className='flex min-w-52 flex-1 flex-col gap-1.5'><label htmlFor='sensitive-word-user' className='text-sm font-medium'>{t('User')}</label><Input id='sensitive-word-user' value={userFilter} onChange={(event) => setUserFilter(event.target.value)} placeholder={t('Filter by username')} onKeyDown={(event) => event.key === 'Enter' && handleSearch()} /></div>
            <div className='flex min-w-44 flex-col gap-1.5'><span className='text-sm font-medium'>{t('Start Time')}</span><DatePicker selected={startDate} onSelect={setStartDate} /></div>
            <div className='flex min-w-44 flex-col gap-1.5'><span className='text-sm font-medium'>{t('End Time')}</span><DatePicker selected={endDate} onSelect={setEndDate} /></div>
            <div className='flex min-w-40 flex-col gap-1.5'><span className='text-sm font-medium'>{t('Filter')}</span><Select value={highlightedOnly ? 'highlighted' : 'all'} onValueChange={(value) => setHighlightedOnly(value === 'highlighted')}><SelectTrigger><SelectValue>{highlightedOnly ? t('Highlighted only') : t('All')}</SelectValue></SelectTrigger><SelectContent><SelectItem value='all'>{t('All')}</SelectItem><SelectItem value='highlighted'>{t('Highlighted only')}</SelectItem></SelectContent></Select></div>
            <div className='flex gap-2'><Button type='button' onClick={handleSearch}><Search />{t('Search')}</Button><Button type='button' variant='outline' onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw className={query.isFetching ? 'animate-spin' : undefined} />{t('Refresh')}</Button><Button type='button' variant='outline' onClick={() => { setUserFilter(''); setStartDate(undefined); setEndDate(undefined); setHighlightedOnly(false); setFilters({}); setPage(1) }}><RotateCcw />{t('Reset')}</Button></div>
          </div>
          <div className='text-muted-foreground flex items-center gap-2 text-sm'><ShieldAlert className='size-4' />{t('Review blocked requests and repeated violations.')}</div>
          <div className='min-h-0 flex-1 overflow-auto rounded-lg border'>
            <Table className='table-fixed'><TableHeader><TableRow><TableHead>{t('User')}</TableHead><TableHead className='w-32 text-right'>{t('Violations')}</TableHead></TableRow></TableHeader><TableBody>
              {query.data?.items.map((user) => {
                const isExpanded = expandedUser === user.user_id
                return (
                  <Fragment key={`${user.user_id}-${user.username}`}>
                    <TableRow>
                      <TableCell colSpan={2} className='p-0'>
                        <button
                          type='button'
                          aria-expanded={isExpanded}
                          className='hover:bg-muted/50 grid w-full grid-cols-[minmax(0,1fr)_8rem] items-center gap-4 px-3 py-3 text-left'
                          onClick={() => setExpandedUser(isExpanded ? null : user.user_id)}
                        >
                          <span className='flex items-center gap-3 font-medium'><ChevronDown className={`size-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />{user.username || `#${user.user_id}`}{user.highlighted && <Badge variant='destructive'>{t('Highlighted')}</Badge>}</span>
                          <span className='text-muted-foreground text-right tabular-nums'>{user.violation_count}</span>
                        </button>
                      </TableCell>
                    </TableRow>
                    {isExpanded && <TableRow><TableCell colSpan={2} className='p-0'><UserDetails user={user} filters={filters} selectedIds={selectedIds} onSelectionChange={handleSelectionChange} onReset={(id) => resetMutation.mutate(id)} onBan={(id) => banMutation.mutate(id)} /></TableCell></TableRow>}
                  </Fragment>
                )
              })}
              {!query.isLoading && (query.data?.items.length ?? 0) === 0 && <TableRow><TableCell colSpan={2}>{t('No sensitive-word violations found.')}</TableCell></TableRow>}
            </TableBody></Table>
            <PageButtons page={page} pageSize={20} total={query.data?.total ?? 0} onPageChange={(next) => { setPage(next); setExpandedUser(null) }} />
          </div>
          <div className='flex items-center justify-end gap-3 rounded-lg border bg-muted/20 px-3 py-2'>
            <span className='text-muted-foreground text-sm'>{t('Selected {{count}}', { count: selectedIds.size })}</span>
            <Button type='button' variant='destructive' disabled={selectedIds.size === 0} onClick={() => setDeleteOpen(true)}><Trash2 />{t('Delete records')}</Button>
          </div>
        </div>
      </SectionPageLayout.Content>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('Delete records')}</DialogTitle><DialogDescription>{t('Choose a cutoff to permanently delete earlier sensitive-word violation records.')} {t('Selected {{count}}', { count: selectedIds.size })}</DialogDescription></DialogHeader>
          <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
            {[['1', '1 day ago'], ['3', '3 days ago'], ['7', '7 days ago'], ['custom', 'Custom date']].map(([value, label]) => <Button key={value} type='button' variant={deletePreset === value ? 'default' : 'outline'} onClick={() => setDeletePreset(value)}>{t(label)}</Button>)}
          </div>
          {deletePreset === 'custom' && <div className='flex flex-col gap-1.5'><span className='text-sm font-medium'>{t('Delete before date')}</span><DatePicker selected={deleteDate} onSelect={setDeleteDate} /></div>}
          <p className='text-muted-foreground text-sm'>{t('Records before the cutoff will be permanently deleted.')}</p>
          <DialogFooter><Button variant='outline' onClick={() => setDeleteOpen(false)}>{t('Cancel')}</Button><Button variant='destructive' disabled={deleteMutation.isPending || !canDelete} onClick={() => deleteMutation.mutate(selectedBeforeTime !== undefined ? { ids: [...selectedIds], beforeTime: selectedBeforeTime } : { ids: [...selectedIds], days: selectedDays })}><Trash2 />{t('Delete')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionPageLayout>
  )
}
