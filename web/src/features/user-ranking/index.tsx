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
  const [ipsTarget, setIpsTarget] = useState<UserRanking | null>(null)
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.isLoading && (
                  <TableRow>
                    <TableCell colSpan={5}>{t('Loading...')}</TableCell>
                  </TableRow>
                )}
                {!query.isLoading && items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>{t('No user ranking data found.')}</TableCell>
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
                          onClick={() => setIpsTarget(item)}
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

      <Dialog open={ipsTarget !== null} onOpenChange={(open) => !open && setIpsTarget(null)}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>
              {ipsTarget
                ? t('All IPs of {{username}}', {
                    username: ipsTarget.username || `#${ipsTarget.user_id}`,
                  })
                : t('All IPs')}
            </DialogTitle>
            {ipsTarget && (
              <DialogDescription>
                {t('{{count}} IPs in total.', {
                  count: formatNumber(ipsTarget.ips.length),
                })}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className='relative'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='absolute top-2 right-2 z-10 h-8 w-8 p-0'
              title={t('Copy to clipboard')}
              aria-label={t('Copy to clipboard')}
              onClick={() => {
                if (ipsTarget && ipsTarget.ips.length > 0) {
                  void copyToClipboard(ipsTarget.ips.join('\n'))
                }
              }}
              disabled={!ipsTarget || ipsTarget.ips.length === 0}
            >
              {copiedText === ipsTarget?.ips.join('\n') ? (
                <Check className='size-4 text-green-600' />
              ) : (
                <Copy className='size-4' />
              )}
            </Button>
            <textarea
              readOnly
              value={ipsTarget?.ips.join('\n') ?? ''}
              aria-label={t('All IPs')}
              className='bg-muted/50 h-[45vh] w-full resize-none rounded-md border p-3 pr-10 font-mono text-xs leading-relaxed'
            />
          </div>
        </DialogContent>
      </Dialog>
    </SectionPageLayout>
  )
}
