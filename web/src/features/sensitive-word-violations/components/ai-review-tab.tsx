/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  Ban,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Megaphone,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DatePicker } from '@/components/date-picker'
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
import { Label } from '@/components/ui/label'
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
import { Textarea } from '@/components/ui/textarea'
import { copyToClipboard } from '@/lib/copy-to-clipboard'

import {
  deleteAIReviewRecords,
  getAIReviewRecords,
  getAIReviewStats,
  handleAIReviewRecord,
  type AIReviewAdminStatus,
  type AIReviewFilters,
  type AIReviewHandleAction,
  type AIReviewRecord,
  type AIReviewSource,
  type AIReviewVerdict,
} from '../api-ai-review'

const PAGE_SIZE = 20

function formatTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString()
}

function verdictLabel(verdict: AIReviewVerdict): string {
  if (verdict === 'flagged') return 'Flagged'
  if (verdict === 'safe') return 'Safe'
  return 'Review error'
}

function verdictVariant(verdict: AIReviewVerdict): 'destructive' | 'secondary' {
  return verdict === 'flagged' ? 'destructive' : 'secondary'
}

function adminStatusLabel(adminStatus: AIReviewAdminStatus): string {
  if (adminStatus === 0) return 'Pending review'
  if (adminStatus === 1) return 'Confirmed violation'
  if (adminStatus === 3) return 'No action needed'
  return 'Dismissed as false positive'
}

function verdictFilterLabel(verdict: AIReviewVerdict | 'all'): string {
  return verdict === 'all' ? 'All' : verdictLabel(verdict)
}

// 后端类别以固定英文短码入库；界面按短码映射为可翻译文案。
function categoryLabel(category: string): string {
  switch (category) {
    case 'fraud':
      return 'Fraud or phishing'
    case 'sexual_minor':
      return 'Sexual content involving minors'
    case 'violence':
      return 'Violence or incitement'
    case 'malware':
      return 'Malware or cyberattack'
    case 'gambling':
      return 'Gambling'
    case 'drugs':
      return 'Drugs'
    case 'weapon':
      return 'Weapons'
    case 'hate':
      return 'Hate speech'
    default:
      return 'Other'
  }
}

function sourceFilterLabel(source: AIReviewSource | 'all'): string {
  if (source === 'all') return 'All'
  return source === 'sensitive_hit' ? 'Sensitive word hit' : 'Sampled'
}

function statusFilterLabel(
  status: AIReviewAdminStatus | 'pending' | 'all'
): string {
  if (status === 'pending') return 'Pending review'
  if (status === 'all') return 'All'
  return adminStatusLabel(status)
}

export interface AIReviewExcerptView {
  role: string
  content: string
  key: string
}

/** 解析按 role 归组的摘录 JSON；敏感词来源的摘录是纯文本，原样返回。 */
function parseExcerpt(record: AIReviewRecord): AIReviewExcerptView[] | null {
  if (record.source !== 'sampled') return null
  try {
    const parsed = JSON.parse(record.request_excerpt) as {
      role: string
      content: string
    }[]
    if (!Array.isArray(parsed)) return null
    const seen = new Map<string, number>()
    return parsed.map((view) => {
      const base = `${view.role}:${view.content.slice(0, 32)}`
      const ordinal = seen.get(base) ?? 0
      seen.set(base, ordinal + 1)
      return { ...view, key: `${base}#${ordinal}` }
    })
  } catch {
    return null
  }
}

function parseMatchedWords(record: AIReviewRecord): string[] {
  if (!record.matched_words) return []
  try {
    const parsed = JSON.parse(record.matched_words) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((word): word is string => typeof word === 'string')
      : []
  } catch {
    return []
  }
}

function AIReviewEvidenceDialog(props: {
  record: AIReviewRecord | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [comment, setComment] = useState('')
  const [copiedField, setCopiedField] = useState<
    'excerpt' | 'request_id' | null
  >(null)
  const recordId = props.record?.id

  useEffect(() => {
    setComment('')
    setCopiedField(null)
  }, [recordId])

  useEffect(() => {
    if (!copiedField) return
    const timer = window.setTimeout(() => setCopiedField(null), 2000)
    return () => window.clearTimeout(timer)
  }, [copiedField])

  const handleMutation = useMutation({
    mutationFn: (action: AIReviewHandleAction) =>
      handleAIReviewRecord({
        id: props.record?.id ?? 0,
        action,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      }),
    onSuccess: (_data, action) => {
      toast.success(t('Review handled'))
      props.onClose()
      void queryClient.invalidateQueries({ queryKey: ['ai-review'] })
      if (action === 'warn' || action === 'ban') {
        void queryClient.invalidateQueries({ queryKey: ['users'] })
      }
    },
    onError: () => toast.error(t('Failed to handle the review record')),
  })

  const record = props.record
  const excerptViews = record ? parseExcerpt(record) : null
  const matchedWords = record ? parseMatchedWords(record) : []

  return (
    <Dialog
      open={props.record !== null}
      onOpenChange={(open) => !open && props.onClose()}
    >
      <DialogContent className='sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{t('AI Review Evidence')}</DialogTitle>
          <DialogDescription>
            {record &&
              `${formatTime(record.created_at)} · ${record.username || `#${record.user_id}`} · ${record.request_path}`}
          </DialogDescription>
        </DialogHeader>
        {record && (
          <div className='grid gap-3'>
            <div className='flex flex-wrap items-center gap-1.5 text-xs'>
              <Badge variant={verdictVariant(record.verdict)}>
                {t(verdictLabel(record.verdict))}
              </Badge>
              {record.category && (
                <Badge>{t(categoryLabel(record.category))}</Badge>
              )}
              {record.confidence > 0 && (
                <Badge variant='outline'>
                  {t('Confidence')} {(record.confidence * 100).toFixed(0)}%
                </Badge>
              )}
              <Badge variant='outline'>
                {record.source === 'sensitive_hit'
                  ? t('Sensitive word hit')
                  : t('Sampled')}
              </Badge>
            </div>
            {(record.model_name || record.request_id) && (
              <div className='text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs'>
                {record.model_name && (
                  <span>
                    {t('Model')}:{' '}
                    <span className='text-foreground'>{record.model_name}</span>
                  </span>
                )}
                {record.request_id && (
                  <span className='flex items-center gap-1'>
                    {t('Request ID')}:{' '}
                    <span className='text-foreground break-all'>
                      {record.request_id}
                    </span>
                    <Button
                      type='button'
                      size='icon'
                      variant='ghost'
                      className='size-5'
                      aria-label={t('Copy')}
                      onClick={async () => {
                        if (await copyToClipboard(record.request_id)) {
                          setCopiedField('request_id')
                          toast.success(t('Copied'))
                        } else {
                          toast.error(t('Copy failed'))
                        }
                      }}
                    >
                      {copiedField === 'request_id' ? <Check /> : <Copy />}
                    </Button>
                  </span>
                )}
              </div>
            )}
            {record.reason && (
              <div className='rounded border p-2 text-xs'>
                <span className='text-muted-foreground'>
                  {t('AI reason')}:{' '}
                </span>
                {record.reason}
              </div>
            )}
            {matchedWords.length > 0 && (
              <div className='flex flex-wrap items-center gap-1.5 text-xs'>
                <span className='text-muted-foreground'>
                  {t('Matched Words')}
                </span>
                {matchedWords.map((word) => (
                  <Badge key={word} variant='destructive'>
                    {word}
                  </Badge>
                ))}
              </div>
            )}
            <div className='flex items-center justify-between gap-2'>
              <span className='text-muted-foreground text-xs'>
                {t('Request Excerpt')}
              </span>
              <Button
                type='button'
                size='sm'
                variant='outline'
                disabled={!record.request_excerpt}
                onClick={async () => {
                  if (
                    record.request_excerpt &&
                    (await copyToClipboard(record.request_excerpt))
                  ) {
                    setCopiedField('excerpt')
                    toast.success(t('Copied'))
                  } else {
                    toast.error(t('Copy failed'))
                  }
                }}
              >
                {copiedField === 'excerpt' ? <Check /> : <Copy />}
                {copiedField === 'excerpt' ? t('Copied') : t('Copy')}
              </Button>
            </div>
            <div className='max-h-[45vh] overflow-auto rounded border p-3 text-xs'>
              {excerptViews ? (
                <div className='space-y-2'>
                  {excerptViews.map((view) => (
                    <div key={view.key} className='break-words'>
                      <span className='text-muted-foreground font-medium'>
                        {view.role}:{' '}
                      </span>
                      {view.content}
                    </div>
                  ))}
                </div>
              ) : (
                <pre className='break-words whitespace-pre-wrap'>
                  {record.request_excerpt || '-'}
                </pre>
              )}
            </div>
            {record.admin_status !== 0 ? (
              <div className='text-muted-foreground rounded border p-2 text-xs'>
                {t(adminStatusLabel(record.admin_status))}
                {record.admin_username && ` · ${record.admin_username}`}
                {record.admin_comment && ` · ${record.admin_comment}`}
              </div>
            ) : (
              <>
                <div className='grid gap-1.5'>
                  <Label htmlFor='ai-review-comment'>
                    {t('Handling note (optional)')}
                  </Label>
                  <Textarea
                    id='ai-review-comment'
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    rows={2}
                  />
                </div>
                <DialogFooter className='gap-2 sm:justify-start'>
                  <Button
                    size='sm'
                    variant='destructive'
                    disabled={handleMutation.isPending}
                    onClick={() => handleMutation.mutate('ban')}
                  >
                    <Ban />
                    {t('Ban user')}
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={handleMutation.isPending}
                    onClick={() => handleMutation.mutate('warn')}
                  >
                    <Megaphone />
                    {t('Warn user')}
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={handleMutation.isPending}
                    onClick={() => handleMutation.mutate('confirm')}
                  >
                    <ShieldAlert />
                    {t('Confirm violation')}
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={handleMutation.isPending}
                    onClick={() => handleMutation.mutate('dismiss')}
                  >
                    <X />
                    {t('Dismiss (false positive)')}
                  </Button>
                </DialogFooter>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function AIReviewTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [userFilter, setUserFilter] = useState('')
  const [verdictFilter, setVerdictFilter] = useState<AIReviewVerdict | 'all'>(
    'all'
  )
  const [sourceFilter, setSourceFilter] = useState<AIReviewSource | 'all'>(
    'all'
  )
  const [statusFilter, setStatusFilter] = useState<
    AIReviewAdminStatus | 'pending' | 'all'
  >('all')
  const [startDate, setStartDate] = useState<Date>()
  const [endDate, setEndDate] = useState<Date>()
  const [filters, setFilters] = useState<AIReviewFilters>({})
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [selected, setSelected] = useState<AIReviewRecord | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const query = useQuery({
    queryKey: ['ai-review', 'records', page, filters],
    queryFn: () => getAIReviewRecords(page, PAGE_SIZE, filters),
    placeholderData: keepPreviousData,
  })
  const statsQuery = useQuery({
    queryKey: ['ai-review', 'stats'],
    queryFn: getAIReviewStats,
  })

  const buildFilters = (): AIReviewFilters => {
    const next: AIReviewFilters = {}
    if (userFilter.trim()) next.user = userFilter.trim()
    if (verdictFilter !== 'all') next.verdict = verdictFilter
    if (sourceFilter !== 'all') next.source = sourceFilter
    if (statusFilter === 'pending') next.admin_status = 0
    else if (statusFilter !== 'all') next.admin_status = statusFilter
    if (startDate) {
      const date = new Date(startDate)
      date.setHours(0, 0, 0, 0)
      next.start_time = Math.floor(date.getTime() / 1000)
    }
    if (endDate) {
      const date = new Date(endDate)
      date.setHours(23, 59, 59, 999)
      next.end_time = Math.floor(date.getTime() / 1000)
    }
    return next
  }

  const reloadRecords = (nextFilters: AIReviewFilters) => {
    setPage(1)
    setSelectedIds(new Set())
    setFilters(nextFilters)
    void queryClient.invalidateQueries({ queryKey: ['ai-review'] })
  }

  const handleSearch = () => {
    reloadRecords(buildFilters())
  }

  const handleReset = () => {
    setUserFilter('')
    setVerdictFilter('all')
    setSourceFilter('all')
    setStatusFilter('all')
    setStartDate(undefined)
    setEndDate(undefined)
    reloadRecords({})
  }

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

  const deleteMutation = useMutation({
    mutationFn: deleteAIReviewRecords,
    onSuccess: (data) => {
      setDeleteOpen(false)
      setSelectedIds(new Set())
      toast.success(
        t('Deleted {{count}} review records', { count: data.deleted })
      )
      void queryClient.invalidateQueries({ queryKey: ['ai-review'] })
    },
    onError: () => toast.error(t('Delete failed')),
  })

  const totalPages = Math.max(
    1,
    Math.ceil((query.data?.total ?? 0) / PAGE_SIZE)
  )
  const pageIds = query.data?.items.map((item) => item.id) ?? []
  const selectedPageCount = pageIds.filter((id) => selectedIds.has(id)).length
  const pendingCount = statsQuery.data?.counts['flagged_0'] ?? 0
  const droppedTotal = statsQuery.data?.dropped_total ?? 0

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <div className='bg-muted/20 flex flex-wrap items-end gap-3 rounded-lg border p-3'>
        <div className='flex min-w-44 flex-1 flex-col gap-1.5'>
          <label htmlFor='ai-review-user' className='text-sm font-medium'>
            {t('User')}
          </label>
          <Input
            id='ai-review-user'
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value)}
            placeholder={t('Filter by username')}
            onKeyDown={(event) => event.key === 'Enter' && handleSearch()}
          />
        </div>
        <div className='flex min-w-36 flex-col gap-1.5'>
          <span className='text-sm font-medium'>{t('Verdict')}</span>
          <Select
            value={verdictFilter}
            onValueChange={(value) =>
              setVerdictFilter(value as AIReviewVerdict | 'all')
            }
          >
            <SelectTrigger>
              <SelectValue>{t(verdictFilterLabel(verdictFilter))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>{t('All')}</SelectItem>
              <SelectItem value='flagged'>{t('Flagged')}</SelectItem>
              <SelectItem value='safe'>{t('Safe')}</SelectItem>
              <SelectItem value='error'>{t('Review error')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className='flex min-w-36 flex-col gap-1.5'>
          <span className='text-sm font-medium'>{t('Source')}</span>
          <Select
            value={sourceFilter}
            onValueChange={(value) =>
              setSourceFilter(value as AIReviewSource | 'all')
            }
          >
            <SelectTrigger>
              <SelectValue>{t(sourceFilterLabel(sourceFilter))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>{t('All')}</SelectItem>
              <SelectItem value='sampled'>{t('Sampled')}</SelectItem>
              <SelectItem value='sensitive_hit'>
                {t('Sensitive word hit')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className='flex min-w-36 flex-col gap-1.5'>
          <span className='text-sm font-medium'>{t('Status')}</span>
          <Select
            value={
              statusFilter === 'pending' || statusFilter === 'all'
                ? statusFilter
                : String(statusFilter)
            }
            onValueChange={(value) =>
              setStatusFilter(
                value === 'pending' || value === 'all'
                  ? value
                  : (Number(value) as AIReviewAdminStatus)
              )
            }
          >
            <SelectTrigger>
              <SelectValue>{t(statusFilterLabel(statusFilter))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='pending'>{t('Pending review')}</SelectItem>
              <SelectItem value='all'>{t('All')}</SelectItem>
              <SelectItem value='1'>{t('Confirmed violation')}</SelectItem>
              <SelectItem value='2'>
                {t('Dismissed as false positive')}
              </SelectItem>
              <SelectItem value='3'>{t('No action needed')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className='flex min-w-40 flex-col gap-1.5'>
          <span className='text-sm font-medium'>{t('Start Time')}</span>
          <DatePicker selected={startDate} onSelect={setStartDate} />
        </div>
        <div className='flex min-w-40 flex-col gap-1.5'>
          <span className='text-sm font-medium'>{t('End Time')}</span>
          <DatePicker selected={endDate} onSelect={setEndDate} />
        </div>
        <div className='flex gap-2'>
          <Button type='button' onClick={handleSearch}>
            <Search />
            {t('Search')}
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={() => reloadRecords(filters)}
            disabled={query.isFetching}
          >
            <RefreshCw
              className={query.isFetching ? 'animate-spin' : undefined}
            />
            {t('Refresh')}
          </Button>
          <Button type='button' variant='outline' onClick={handleReset}>
            <RotateCcw />
            {t('Reset')}
          </Button>
        </div>
      </div>
      <div className='text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm'>
        <span className='flex items-center gap-2'>
          <Bot className='size-4' />
          {t(
            'Reviews run after responses complete. Sampled requests judged clean are stored only when record clean sample results is enabled in settings.'
          )}
        </span>
        <span className='tabular-nums'>
          {t('Pending: {{count}}', { count: pendingCount })}
        </span>
        {droppedTotal > 0 && (
          <span className='tabular-nums'>
            {t('Queue overflow dropped: {{count}}', { count: droppedTotal })}
          </span>
        )}
      </div>
      <div className='min-h-0 flex-1 overflow-auto rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-10'>
                <Checkbox
                  checked={
                    pageIds.length > 0 && selectedPageCount === pageIds.length
                  }
                  indeterminate={
                    selectedPageCount > 0 && selectedPageCount < pageIds.length
                  }
                  disabled={pageIds.length === 0}
                  onCheckedChange={(checked) =>
                    handleSelectionChange(pageIds, checked === true)
                  }
                  aria-label={t('Select all')}
                />
              </TableHead>
              <TableHead>{t('Time')}</TableHead>
              <TableHead>{t('User')}</TableHead>
              <TableHead>{t('Source')}</TableHead>
              <TableHead>{t('Verdict')}</TableHead>
              <TableHead>{t('Category')}</TableHead>
              <TableHead>{t('Confidence')}</TableHead>
              <TableHead>{t('Status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data?.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <Checkbox
                    checked={selectedIds.has(item.id)}
                    onCheckedChange={(checked) =>
                      handleSelectionChange([item.id], checked === true)
                    }
                    aria-label={t('Select row')}
                  />
                </TableCell>
                <TableCell className='whitespace-nowrap'>
                  {formatTime(item.created_at)}
                </TableCell>
                <TableCell>
                  <button
                    type='button'
                    className='text-primary text-left underline-offset-4 hover:underline'
                    onClick={() => setSelected(item)}
                  >
                    {item.username || `#${item.user_id}`}
                  </button>
                </TableCell>
                <TableCell>
                  {item.source === 'sensitive_hit'
                    ? t('Sensitive word hit')
                    : t('Sampled')}
                </TableCell>
                <TableCell>
                  <Badge variant={verdictVariant(item.verdict)}>
                    {t(verdictLabel(item.verdict))}
                  </Badge>
                </TableCell>
                <TableCell>
                  {item.category ? t(categoryLabel(item.category)) : '-'}
                </TableCell>
                <TableCell className='tabular-nums'>
                  {item.confidence > 0
                    ? `${(item.confidence * 100).toFixed(0)}%`
                    : '-'}
                </TableCell>
                <TableCell>{t(adminStatusLabel(item.admin_status))}</TableCell>
              </TableRow>
            ))}
            {!query.isLoading && (query.data?.items.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  {t('No AI review records found.')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <div className='flex items-center justify-end gap-2 border-t px-3 py-2'>
          <span className='text-muted-foreground mr-2 text-sm'>
            {t('Total:')} {query.data?.total ?? 0}
          </span>
          <Button
            size='icon'
            variant='outline'
            aria-label={t('Previous page')}
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className='min-w-16 text-center text-sm'>
            {page} / {totalPages}
          </span>
          <Button
            size='icon'
            variant='outline'
            aria-label={t('Next page')}
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div className='bg-muted/20 flex items-center justify-end gap-3 rounded-lg border px-3 py-2'>
        <span className='text-muted-foreground text-sm'>
          {t('Selected {{count}}', { count: selectedIds.size })}
        </span>
        <Button
          type='button'
          variant='destructive'
          disabled={selectedIds.size === 0}
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
              {t('This will permanently delete the selected records.')}{' '}
              {t('Selected {{count}}', { count: selectedIds.size })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button
              variant='destructive'
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate({ ids: [...selectedIds] })}
            >
              <Trash2 />
              {t('Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AIReviewEvidenceDialog
        record={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}
