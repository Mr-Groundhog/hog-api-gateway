import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { DatePicker } from '@/components/date-picker'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import {
  banSensitiveWordViolationUser,
  getSensitiveWordViolations,
  resetSensitiveWordViolationCount,
  type SensitiveWordViolation,
  type SensitiveWordViolationFilters,
} from './api'

const sensitiveWordColumnVisibilityStorageKey =
  'sensitive-word-violations:column-visibility'

const sensitiveWordColumns = [
  { key: 'user', label: 'User' },
  { key: 'ip', label: 'IP' },
  { key: 'time', label: 'Time' },
  { key: 'userAgent', label: 'User Agent' },
  { key: 'request', label: 'Request' },
  { key: 'matchedWords', label: 'Matched Words' },
] as const

type SensitiveWordColumnKey = (typeof sensitiveWordColumns)[number]['key']
type SensitiveWordColumnVisibility = Record<
  SensitiveWordColumnKey,
  boolean
>

const defaultSensitiveWordColumnVisibility: SensitiveWordColumnVisibility = {
  user: true,
  ip: true,
  time: true,
  userAgent: true,
  request: true,
  matchedWords: true,
}

function readSensitiveWordColumnVisibility(): SensitiveWordColumnVisibility {
  if (typeof window === 'undefined') return defaultSensitiveWordColumnVisibility

  try {
    const stored = window.localStorage.getItem(
      sensitiveWordColumnVisibilityStorageKey
    )
    if (!stored) return defaultSensitiveWordColumnVisibility

    const parsed = JSON.parse(stored) as Partial<SensitiveWordColumnVisibility>
    return sensitiveWordColumns.reduce<SensitiveWordColumnVisibility>(
      (visibility, column) => {
        visibility[column.key] = parsed[column.key] ?? true
        return visibility
      },
      { ...defaultSensitiveWordColumnVisibility }
    )
  } catch {
    return defaultSensitiveWordColumnVisibility
  }
}

export function SensitiveWordViolations() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selectedViolation, setSelectedViolation] =
    useState<SensitiveWordViolation | null>(null)
  const [userFilter, setUserFilter] = useState('')
  const [startDate, setStartDate] = useState<Date>()
  const [endDate, setEndDate] = useState<Date>()
  const [highlightedOnly, setHighlightedOnly] = useState(false)
  const [filters, setFilters] = useState<SensitiveWordViolationFilters>({})
  const [columnVisibility, setColumnVisibility] = useState(
    readSensitiveWordColumnVisibility
  )
  const query = useQuery({
    queryKey: ['sensitive-word-violations', filters],
    queryFn: () => getSensitiveWordViolations(1, 100, filters),
  })

  const handleSearch = () => {
    const nextFilters: typeof filters = {}
    const user = userFilter.trim()
    if (user) nextFilters.user = user
    if (startDate) {
      const value = new Date(startDate)
      value.setHours(0, 0, 0, 0)
      nextFilters.start_time = Math.floor(value.getTime() / 1000)
    }
    if (endDate) {
      const value = new Date(endDate)
      value.setHours(23, 59, 59, 999)
      nextFilters.end_time = Math.floor(value.getTime() / 1000)
    }
    if (highlightedOnly) nextFilters.highlighted = true

    const filtersUnchanged =
      nextFilters.user === filters.user &&
      nextFilters.start_time === filters.start_time &&
      nextFilters.end_time === filters.end_time &&
      nextFilters.highlighted === filters.highlighted
    setFilters(nextFilters)
    if (filtersUnchanged) void query.refetch()
  }

  const handleRefresh = () => {
    void query.refetch()
  }

  const handleReset = () => {
    setUserFilter('')
    setStartDate(undefined)
    setEndDate(undefined)
    setHighlightedOnly(false)
    setFilters({})
  }

  useEffect(() => {
    window.localStorage.setItem(
      sensitiveWordColumnVisibilityStorageKey,
      JSON.stringify(columnVisibility)
    )
  }, [columnVisibility])

  const visibleColumnCount = sensitiveWordColumns.filter(
    (column) => columnVisibility[column.key]
  ).length
  const banMutation = useMutation({
    mutationFn: banSensitiveWordViolationUser,
    onSuccess: () => {
      toast.success(t('User banned successfully'))
      void queryClient.invalidateQueries({
        queryKey: ['sensitive-word-violations'],
      })
    },
    onError: () => toast.error(t('Failed to ban user')),
  })
  const resetCountMutation = useMutation({
    mutationFn: resetSensitiveWordViolationCount,
    onSuccess: () => {
      toast.success(t('Reset completed'))
      void queryClient.invalidateQueries({
        queryKey: ['sensitive-word-violations'],
      })
    },
    onError: () => toast.error(t('Reset failed')),
  })

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('Sensitive Word Triggers')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='flex h-full min-h-0 flex-col gap-3'>
            <div className='bg-muted/20 flex flex-wrap items-end gap-3 rounded-lg border p-3'>
              <div className='flex min-w-52 flex-1 flex-col gap-1.5'>
                <label
                  htmlFor='sensitive-word-user'
                  className='text-sm font-medium'
                >
                  {t('User')}
                </label>
                <Input
                  id='sensitive-word-user'
                  value={userFilter}
                  onChange={(event) => setUserFilter(event.target.value)}
                  placeholder={t('Filter by username')}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleSearch()
                  }}
                />
              </div>
              <div className='flex min-w-52 flex-col gap-1.5'>
                <span className='text-sm font-medium'>{t('Start Time')}</span>
                <DatePicker selected={startDate} onSelect={setStartDate} />
              </div>
              <div className='flex min-w-52 flex-col gap-1.5'>
                <span className='text-sm font-medium'>{t('End Time')}</span>
                <DatePicker selected={endDate} onSelect={setEndDate} />
              </div>
              <div className='flex min-w-44 flex-col gap-1.5'>
                <span className='text-sm font-medium'>{t('Filter')}</span>
                <Select
                  value={highlightedOnly ? 'highlighted' : 'all'}
                  onValueChange={(value) => {
                    if (value === 'all' || value === 'highlighted') {
                      setHighlightedOnly(value === 'highlighted')
                    }
                  }}
                >
                  <SelectTrigger className='w-full'>
                    <SelectValue>
                      {highlightedOnly ? t('Highlighted only') : t('All')}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectItem value='all'>{t('All')}</SelectItem>
                    <SelectItem value='highlighted'>
                      {t('Highlighted only')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className='flex gap-2'>
                <Button type='button' onClick={handleSearch}>
                  <Search />
                  {t('Search')}
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  onClick={handleRefresh}
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
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type='button'
                        variant='outline'
                        aria-label={t('View')}
                      />
                    }
                  >
                    <Settings2 />
                    {t('View')}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-48'>
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>
                        {t('Toggle columns')}
                      </DropdownMenuLabel>
                      {sensitiveWordColumns.map((column) => (
                        <DropdownMenuCheckboxItem
                          key={column.key}
                          checked={columnVisibility[column.key]}
                          onCheckedChange={(checked) =>
                            setColumnVisibility((current) => ({
                              ...current,
                              [column.key]: checked === true,
                            }))
                          }
                        >
                          {t(column.label)}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className='text-muted-foreground flex items-center gap-2 text-sm'>
              <ShieldAlert className='size-4' />
              {t('Review blocked requests and repeated violations.')}
            </div>
            <div className='min-h-0 flex-1 overflow-auto rounded-lg border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    {columnVisibility.user && <TableHead>{t('User')}</TableHead>}
                    {columnVisibility.ip && <TableHead>{t('IP')}</TableHead>}
                    {columnVisibility.time && <TableHead>{t('Time')}</TableHead>}
                    {columnVisibility.userAgent && (
                      <TableHead>{t('User Agent')}</TableHead>
                    )}
                    {columnVisibility.request && (
                      <TableHead>{t('Request')}</TableHead>
                    )}
                    {columnVisibility.matchedWords && (
                      <TableHead>{t('Matched Words')}</TableHead>
                    )}
                    <TableHead className='bg-background sticky right-0 z-20 min-w-56 border-l shadow-[-4px_0_8px_-6px_hsl(var(--border))]'>
                      {t('Actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.isLoading && (
                    <TableRow>
                      <TableCell colSpan={visibleColumnCount + 1}>
                        {t('Loading...')}
                      </TableCell>
                    </TableRow>
                  )}
                  {!query.isLoading &&
                    (query.data?.items.length ?? 0) === 0 && (
                      <TableRow>
                        <TableCell colSpan={visibleColumnCount + 1}>
                          {t('No sensitive-word violations found.')}
                        </TableCell>
                      </TableRow>
                    )}
                  {query.data?.items.map((item) => (
                    <TableRow key={item.id}>
                      {columnVisibility.user && <TableCell>
                        <div className='flex items-center gap-2'>
                          {item.highlighted && (
                            <Badge variant='destructive'>
                              {t('Highlighted')}
                            </Badge>
                          )}
                          <span>{item.username || `#${item.user_id}`}</span>
                          <span className='text-muted-foreground'>
                            ({item.trigger_count})
                          </span>
                        </div>
                      </TableCell>}
                      {columnVisibility.ip && <TableCell>{item.ip}</TableCell>}
                      {columnVisibility.time && <TableCell>
                        {new Date(item.created_at * 1000).toLocaleString()}
                      </TableCell>}
                      {columnVisibility.userAgent && <TableCell
                        className='max-w-56 truncate'
                        title={item.user_agent}
                      >
                        {item.user_agent}
                      </TableCell>}
                      {columnVisibility.request && <TableCell className='max-w-72'>
                        <button
                          type='button'
                          className='text-primary focus-visible:ring-ring block max-w-full cursor-pointer truncate text-left underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:outline-none'
                          onClick={() => setSelectedViolation(item)}
                        >
                          {item.request_path}: {item.request_content}
                        </button>
                      </TableCell>}
                      {columnVisibility.matchedWords && <TableCell>{item.matched_words}</TableCell>}
                      <TableCell className='bg-background sticky right-0 z-10 border-l shadow-[-4px_0_8px_-6px_hsl(var(--border))]'>
                        <div className='flex items-center gap-2 whitespace-nowrap'>
                          <Button
                            size='sm'
                            variant='outline'
                            disabled={
                              resetCountMutation.isPending || item.user_id <= 0
                            }
                            onClick={() =>
                              resetCountMutation.mutate(item.user_id)
                            }
                          >
                            <RotateCcw />
                            {t('Reset count')}
                          </Button>
                          <Button
                            size='sm'
                            variant='destructive'
                            disabled={
                              banMutation.isPending || item.user_id <= 0
                            }
                            onClick={() => banMutation.mutate(item.user_id)}
                          >
                            <Ban />
                            {t('Ban user')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <Dialog
        open={selectedViolation !== null}
        onOpenChange={(open) => !open && setSelectedViolation(null)}
      >
        <DialogContent className='max-h-[85vh] overflow-hidden sm:max-w-3xl'>
          <DialogHeader>
            <DialogTitle>
              {t('Request')} #{selectedViolation?.id}
            </DialogTitle>
            <DialogDescription>
              {t('Review blocked requests and repeated violations.')}
            </DialogDescription>
          </DialogHeader>

          {selectedViolation && (
            <div className='min-h-0 space-y-4 overflow-y-auto pr-1'>
              <div className='grid gap-3 sm:grid-cols-2'>
                <div>
                  <div className='text-muted-foreground text-xs font-medium'>
                    {t('User')}
                  </div>
                  <div className='mt-1 break-all'>
                    {selectedViolation.username ||
                      `#${selectedViolation.user_id}`}{' '}
                    ({selectedViolation.trigger_count})
                  </div>
                </div>
                <div>
                  <div className='text-muted-foreground text-xs font-medium'>
                    {t('IP')}
                  </div>
                  <div className='mt-1 font-mono break-all'>
                    {selectedViolation.ip}
                  </div>
                </div>
                <div>
                  <div className='text-muted-foreground text-xs font-medium'>
                    {t('Time')}
                  </div>
                  <div className='mt-1'>
                    {new Date(
                      selectedViolation.created_at * 1000
                    ).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className='text-muted-foreground text-xs font-medium'>
                    {t('User Agent')}
                  </div>
                  <div className='mt-1 break-all'>
                    {selectedViolation.user_agent}
                  </div>
                </div>
              </div>

              <div>
                <div className='text-muted-foreground text-xs font-medium'>
                  {t('Matched Words')}
                </div>
                <div className='mt-1 font-mono break-all'>
                  {selectedViolation.matched_words}
                </div>
                <div className='text-muted-foreground mt-1 font-mono text-xs break-all'>
                  {selectedViolation.match_locations}
                </div>
              </div>

              <div>
                <div className='flex items-center justify-between gap-2'>
                  <div className='text-muted-foreground text-xs font-medium'>
                    {t('Request')}
                  </div>
                  <CopyButton
                    value={selectedViolation.request_content}
                    tooltip={t('Copy to clipboard')}
                  />
                </div>
                <div className='text-muted-foreground mt-1 font-mono text-xs break-all'>
                  {selectedViolation.request_path}
                </div>
                <pre className='bg-muted/40 mt-2 max-h-[40vh] overflow-auto rounded-md border p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap'>
                  {selectedViolation.request_content}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
