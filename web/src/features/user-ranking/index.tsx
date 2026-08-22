import { useQuery } from '@tanstack/react-query'
import { Check, Copy, ListOrdered, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Dialog } from '@/components/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

import {
  getUserRankings,
  type UserRanking,
  type UserRankingPeriod,
} from './api'

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat().format(
    typeof value === 'number' && Number.isFinite(value) ? value : 0
  )
}

export function UserRanking() {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard()
  const [period, setPeriod] = useState<UserRankingPeriod>('today')
  const [detailTarget, setDetailTarget] = useState<UserRanking | null>(null)
  const query = useQuery({
    queryKey: ['user-rankings', period],
    queryFn: () => getUserRankings(period),
    refetchInterval: 30_000,
  })

  const data = query.data
  const items = data?.items ?? []

  return (
    <>
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
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                <ListOrdered className='size-4' aria-hidden='true' />
                <span>{t('Ranked by the number of unique IP addresses.')}</span>
              </div>
              <RadioGroup
                value={period}
                onValueChange={(value) => {
                  setPeriod(value as UserRankingPeriod)
                }}
                className='flex items-center gap-4'
                aria-label={t('Ranking period')}
              >
                <Label className='flex cursor-pointer items-center gap-2 text-sm font-normal'>
                  <RadioGroupItem value='today' />
                  {t('Today')}
                </Label>
                <Label className='flex cursor-pointer items-center gap-2 text-sm font-normal'>
                  <RadioGroupItem value='3days' />
                  {t('Last 3 days')}
                </Label>
              </RadioGroup>
            </div>

            <div className='min-h-0 flex-1 overflow-auto rounded-lg border'>
              <Table className='min-w-[1080px] table-fixed'>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-40'>{t('User')}</TableHead>
                    <TableHead className='w-20 text-right'>{t('IP Count')}</TableHead>
                    <TableHead className='w-[520px]'>{t('All IPs')}</TableHead>
                    <TableHead className='w-36 text-right'>
                      {t('IPs in Last 10 Minutes')}
                    </TableHead>
                    <TableHead className='w-36 text-right'>
                      {t(
                        period === 'today'
                          ? "Today's API Calls"
                          : 'API Calls in Last 3 Days'
                      )}
                    </TableHead>
                    <TableHead className='bg-background sticky right-0 z-20 w-28 border-l text-right shadow-[-4px_0_8px_-6px_hsl(var(--border))]'>
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
                      <TableCell className='w-20 text-right'>
                        <Badge variant='secondary'>{formatNumber(item.ip_count)}</Badge>
                      </TableCell>
                      <TableCell className='w-[520px]'>
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
                      <TableCell className='w-36 text-right'>
                        {formatNumber(item.ten_minute_ip_count)}
                      </TableCell>
                      <TableCell className='w-36 text-right'>
                        {formatNumber(item.api_calls)}
                      </TableCell>
                      <TableCell className='bg-background sticky right-0 z-10 w-28 border-l text-right shadow-[-4px_0_8px_-6px_hsl(var(--border))]'>
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

            <div className='text-sm text-muted-foreground'>
              {t('Showing top {{count}} users', { count: 50 })}
            </div>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <Dialog
        open={detailTarget !== null}
        onOpenChange={(open) => !open && setDetailTarget(null)}
        title={
          detailTarget
            ? detailTarget.username || `#${detailTarget.user_id}`
            : t('User Details')
        }
        description={
          detailTarget ? `${t('User ID')}: ${detailTarget.user_id}` : undefined
        }
        contentClassName='sm:max-w-lg'
      >
        <div className='flex flex-col gap-4'>
          <div className='grid grid-cols-3 gap-3'>
            {[
              { label: t('IP Count'), value: formatNumber(detailTarget?.ip_count ?? 0) },
              {
                label: t('IPs in Last 10 Minutes'),
                value: formatNumber(detailTarget?.ten_minute_ip_count ?? 0),
              },
              {
                label: t(
                  period === 'today'
                    ? "Today's API Calls"
                    : 'API Calls in Last 3 Days'
                ),
                value: formatNumber(detailTarget?.api_calls ?? 0),
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
      </Dialog>
    </>
  )
}
