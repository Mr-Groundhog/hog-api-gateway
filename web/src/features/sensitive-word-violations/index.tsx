import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, RotateCcw, Search, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from 'sonner'

import {
  banSensitiveWordViolationUser,
  getSensitiveWordViolations,
} from './api'
import type {
  SensitiveWordViolation,
  SensitiveWordViolationFilters,
} from './api'

export function SensitiveWordViolations() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selectedViolation, setSelectedViolation] =
    useState<SensitiveWordViolation | null>(null)
  const [userFilter, setUserFilter] = useState('')
  const [startDate, setStartDate] = useState<Date>()
  const [endDate, setEndDate] = useState<Date>()
  const [filters, setFilters] = useState<SensitiveWordViolationFilters>({})
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
    setFilters(nextFilters)
  }

  const handleReset = () => {
    setUserFilter('')
    setStartDate(undefined)
    setEndDate(undefined)
    setFilters({})
  }
  const banMutation = useMutation({
    mutationFn: banSensitiveWordViolationUser,
    onSuccess: () => {
      toast.success(t('User banned successfully'))
      void queryClient.invalidateQueries({ queryKey: ['sensitive-word-violations'] })
    },
    onError: () => toast.error(t('Failed to ban user')),
  })

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('Sensitive Word Triggers')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='flex h-full min-h-0 flex-col gap-3'>
            <div className='flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3'>
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
              <div className='flex gap-2'>
                <Button type='button' onClick={handleSearch}>
                  <Search />
                  {t('Search')}
                </Button>
                <Button type='button' variant='outline' onClick={handleReset}>
                  <RotateCcw />
                  {t('Reset')}
                </Button>
              </div>
            </div>
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <ShieldAlert className='size-4' />
              {t('Review blocked requests and repeated violations.')}
            </div>
            <div className='min-h-0 flex-1 overflow-auto rounded-lg border'>
              <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('User')}</TableHead>
                  <TableHead>{t('IP')}</TableHead>
                  <TableHead>{t('Time')}</TableHead>
                  <TableHead>{t('User Agent')}</TableHead>
                  <TableHead>{t('Request')}</TableHead>
                  <TableHead>{t('Matched Words')}</TableHead>
                  <TableHead>{t('Actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.isLoading && (
                  <TableRow><TableCell colSpan={7}>{t('Loading...')}</TableCell></TableRow>
                )}
                {!query.isLoading && (query.data?.items.length ?? 0) === 0 && (
                  <TableRow><TableCell colSpan={7}>{t('No sensitive-word violations found.')}</TableCell></TableRow>
                )}
                {query.data?.items.map((item) => (
                  <TableRow key={item.id} className={item.highlighted ? 'bg-destructive/10' : undefined}>
                    <TableCell>
                      <div className='flex items-center gap-2'>
                        {item.highlighted && <Badge variant='destructive'>{t('Highlighted')}</Badge>}
                        <span>{item.username || `#${item.user_id}`}</span>
                        <span className='text-muted-foreground'>({item.trigger_count})</span>
                      </div>
                    </TableCell>
                    <TableCell>{item.ip}</TableCell>
                    <TableCell>{new Date(item.created_at * 1000).toLocaleString()}</TableCell>
                    <TableCell className='max-w-56 truncate' title={item.user_agent}>{item.user_agent}</TableCell>
                    <TableCell className='max-w-72'>
                      <button
                        type='button'
                        className='block max-w-full cursor-pointer truncate text-left text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                        title={item.request_content}
                        onClick={() => setSelectedViolation(item)}
                      >
                        {item.request_path}: {item.request_content}
                      </button>
                    </TableCell>
                    <TableCell>{item.matched_words}</TableCell>
                    <TableCell>
                      <Button
                        size='sm'
                        variant='destructive'
                        disabled={banMutation.isPending || item.user_id <= 0}
                        onClick={() => banMutation.mutate(item.user_id)}
                      >
                        <Ban />
                        {t('Ban user')}
                      </Button>
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
                  <div className='text-xs font-medium text-muted-foreground'>{t('User')}</div>
                  <div className='mt-1 break-all'>{selectedViolation.username || `#${selectedViolation.user_id}`} ({selectedViolation.trigger_count})</div>
                </div>
                <div>
                  <div className='text-xs font-medium text-muted-foreground'>{t('IP')}</div>
                  <div className='mt-1 break-all font-mono'>{selectedViolation.ip}</div>
                </div>
                <div>
                  <div className='text-xs font-medium text-muted-foreground'>{t('Time')}</div>
                  <div className='mt-1'>{new Date(selectedViolation.created_at * 1000).toLocaleString()}</div>
                </div>
                <div>
                  <div className='text-xs font-medium text-muted-foreground'>{t('User Agent')}</div>
                  <div className='mt-1 break-all'>{selectedViolation.user_agent}</div>
                </div>
              </div>

              <div>
                <div className='text-xs font-medium text-muted-foreground'>{t('Matched Words')}</div>
                <div className='mt-1 break-all font-mono'>{selectedViolation.matched_words}</div>
                <div className='mt-1 break-all font-mono text-xs text-muted-foreground'>{selectedViolation.match_locations}</div>
              </div>

              <div>
                <div className='text-xs font-medium text-muted-foreground'>{t('Request')}</div>
                <div className='mt-1 break-all font-mono text-xs text-muted-foreground'>{selectedViolation.request_path}</div>
                <pre className='mt-2 max-h-[40vh] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono text-xs leading-5'>
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
