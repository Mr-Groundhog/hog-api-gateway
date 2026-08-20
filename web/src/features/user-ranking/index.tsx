import { useQuery } from '@tanstack/react-query'
import { Check, ChevronLeft, ChevronRight, Copy, ListOrdered, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

import { getUserRankings, type UserRanking } from './api'

const PAGE_SIZE = 20

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}

export function UserRanking() {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard()
  const [page, setPage] = useState(1)
  const [detailTarget, setDetailTarget] = useState<UserRanking | null>(null)
  const query = useQuery({
    queryKey: ['user-rankings', page],
    queryFn: () => getUserRankings(page, PAGE_SIZE),
    placeholderData: (previous) => previous,
    refetchInterval: 30_000,
  })

  const data = query.data
  const items = data?.items ?? []
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('User Rankings')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          type='button'
          variant='outline'
          size='icon'
          title={t('Refresh')}
          aria-label={t('Refresh')}
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={query.isFetching ? 'animate-spin' : undefined} />
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 flex-col gap-3'>
          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
            <ListOrdered className='size-4' aria-hidden='true' />
            <span>{t('Ranked by the number of unique IP addresses.')}</span>
          </div>

          <div className='min-h-0 flex-1 overflow-auto rounded-lg border'>
            <Table className='min-w-[920px]'>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('User')}</TableHead>
                  <TableHead className='text-right'>{t('IP Count')}</TableHead>
                  <TableHead>{t('All IPs')}</TableHead>
                  <TableHead className='text-right'>{t('IPs in Last Minute')}</TableHead>
                  <TableHead className='text-right'>{t("Today's API Calls")}</TableHead>
                  <TableHead className='bg-background sticky right-0 z-20 min-w-24 border-l text-right shadow-[-4px_0_8px_-6px_hsl(var(--border))]'>
                    {t('Actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.isLoading && (
                  <TableRow>
                    <TableCell colSpan={6}>{t('Loading...')}</TableCell>
                  </TableRow>
                )}
                {!query.isLoading && items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>{t('No user ranking data found.')}</TableCell>
                  </TableRow>
                )}
                {items.map((item) => (
                  <TableRow key={item.user_id}>
                    <TableCell className='font-medium'>
                      {item.username || `#${item.user_id}`}
                    </TableCell>
                    <TableCell className='text-right'>
                      <Badge variant='secondary'>{formatNumber(item.ip_count)}</Badge>
                    </TableCell>
                    <TableCell>
                      {item.ips.length > 0 ? (
                        <Button
                          type='button'
                          variant='ghost'
                          className='h-auto w-full max-w-[520px] justify-start px-0 py-0 font-mono text-xs'
                          title={t('All IPs of {{username}}', {
                            username: item.username || `#${item.user_id}`,
                          })}
                          onClick={() => setDetailTarget(item)}
                        >
                          <span className='min-w-0 truncate'>{item.ips.join(', ')}</span>
                        </Button>
                      ) : (
                        <span className='text-muted-foreground'>-</span>
                      )}
                    </TableCell>
                    <TableCell className='text-right'>
                      {formatNumber(item.recent_ip_count)}
                    </TableCell>
                    <TableCell className='text-right'>
                      {formatNumber(item.today_api_calls)}
                    </TableCell>
                    <TableCell className='bg-background sticky right-0 z-10 border-l text-right shadow-[-4px_0_8px_-6px_hsl(var(--border))]'>
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={() => setDetailTarget(item)}
                      >
                        {t('Details')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className='flex items-center justify-between gap-3 text-sm text-muted-foreground'>
            <span>
              {formatNumber(data?.total ?? 0)} {t('Users')} · {page} / {totalPages}
            </span>
            <div className='flex items-center gap-1'>
              <Button
                type='button'
                variant='outline'
                size='icon-sm'
                title={t('Previous page')}
                aria-label={t('Previous page')}
                disabled={page <= 1 || query.isFetching}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ChevronLeft />
              </Button>
              <Button
                type='button'
                variant='outline'
                size='icon-sm'
                title={t('Next page')}
                aria-label={t('Next page')}
                disabled={page >= totalPages || query.isFetching}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </div>
      </SectionPageLayout.Content>

      <Dialog
        open={detailTarget !== null}
        onOpenChange={(open) => !open && setDetailTarget(null)}
      >
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>
              {detailTarget
                ? detailTarget.username || `#${detailTarget.user_id}`
                : t('User Details')}
            </DialogTitle>
            {detailTarget && (
              <DialogDescription>
                {t('User ID')}: {detailTarget.user_id}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className='flex flex-col gap-4'>
            <div className='grid grid-cols-3 gap-3'>
              {[
                { label: t('IP Count'), value: formatNumber(detailTarget?.ip_count ?? 0) },
                {
                  label: t('IPs in Last Minute'),
                  value: formatNumber(detailTarget?.recent_ip_count ?? 0),
                },
                {
                  label: t("Today's API Calls"),
                  value: formatNumber(detailTarget?.today_api_calls ?? 0),
                },
              ].map((stat) => (
                <div key={stat.label} className='rounded-md border bg-muted/40 p-3'>
                  <div className='text-xs text-muted-foreground'>{stat.label}</div>
                  <div className='mt-1 text-lg font-semibold tabular-nums'>{stat.value}</div>
                </div>
              ))}
            </div>
            <div className='flex flex-col gap-2'>
              <div className='flex items-center justify-between gap-2'>
                <span className='text-sm font-medium'>
                  {t('All IPs')}
                  {detailTarget && detailTarget.ips.length > 0 && (
                    <span className='ml-1 text-xs font-normal text-muted-foreground'>
                      ({formatNumber(detailTarget.ips.length)})
                    </span>
                  )}
                </span>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => {
                    if (detailTarget && detailTarget.ips.length > 0) {
                      void copyToClipboard(detailTarget.ips.join('\n'))
                    }
                  }}
                  disabled={!detailTarget || detailTarget.ips.length === 0}
                >
                  {copiedText === detailTarget?.ips.join('\n') ? (
                    <Check className='size-3.5 text-green-600' />
                  ) : (
                    <Copy className='size-3.5' />
                  )}
                  {t('Copy to clipboard')}
                </Button>
              </div>
              <textarea
                readOnly
                value={detailTarget?.ips.join('\n') ?? ''}
                aria-label={t('All IPs')}
                placeholder={t('No IPs found.')}
                className='bg-muted/50 h-64 w-full resize-none overflow-auto rounded-md border p-3 pr-10 font-mono text-xs leading-relaxed'
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </SectionPageLayout>
  )
}
