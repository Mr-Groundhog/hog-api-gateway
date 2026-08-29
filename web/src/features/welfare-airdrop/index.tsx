/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

For commercial licensing, please contact support@quantumnous.com
*/
import {
  Check,
  Clock,
  Copy,
  Gift,
  LoaderCircle,
  Package,
  RefreshCw,
  Sparkles,
  TicketCheck,
} from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { formatQuota, formatTimestampToDate } from '@/lib/format'

import {
  claimWelfareAirdrop,
  getWelfareAirdropClaims,
  getWelfareAirdrops,
  welfareAirdropQueryKeys,
} from './api'
import type { WelfareAirdrop, WelfareAirdropClaim } from './types'
import './welfare-airdrop.css'

function AirdropOrb() {
  return (
    <div className="airdrop-orb" aria-hidden="true">
      <div className="airdrop-orb-core">
        <Gift />
      </div>
      <i />
      <i />
      <i />
    </div>
  )
}

const CONFETTI_COLORS = [
  '#22d3ee',
  '#a78bfa',
  '#f0abfc',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#60a5fa',
]

function AirdropConverge() {
  const streaks = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => {
        const angle = (i / 30) * Math.PI * 2 + (Math.random() - 0.5) * 0.45
        const distance = 280 + Math.random() * 280
        return {
          sx: Math.round(Math.cos(angle) * distance),
          sy: Math.round(Math.sin(angle) * distance),
          rot: Math.round((angle * 180) / Math.PI),
          delay: (Math.random() * 0.35).toFixed(3),
          duration: (0.65 + Math.random() * 0.5).toFixed(3),
          width: 12 + Math.round(Math.random() * 14),
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        }
      }),
    [],
  )
  return (
    <div className="airdrop-converge" aria-hidden="true">
      {streaks.map((streak, index) => (
        <span
          key={index}
          style={
            {
              '--sx': `${streak.sx}px`,
              '--sy': `${streak.sy}px`,
              '--rot': `${streak.rot}deg`,
              '--delay': `${streak.delay}s`,
              '--dur': `${streak.duration}s`,
              '--c': streak.color,
              width: `${streak.width}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}

function AirdropConfetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 34 }, (_, i) => {
        const angle = (i / 34) * Math.PI * 2 + (Math.random() - 0.5) * 0.5
        const distance = 110 + Math.random() * 240
        return {
          tx: Math.round(Math.cos(angle) * distance),
          ty: Math.round(Math.sin(angle) * distance - 40),
          fall: Math.round(240 + Math.random() * 300),
          rot: Math.round((Math.random() - 0.5) * 900),
          delay: (Math.random() * 0.25).toFixed(3),
          duration: (2.4 + Math.random() * 1.3).toFixed(3),
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          width: 5 + Math.round(Math.random() * 7),
          height: 8 + Math.round(Math.random() * 9),
          round: Math.random() > 0.62,
        }
      }),
    [],
  )
  return (
    <div className="airdrop-confetti" aria-hidden="true">
      {pieces.map((piece, index) => (
        <span
          key={index}
          style={
            {
              '--tx': `${piece.tx}px`,
              '--ty': `${piece.ty}px`,
              '--fall': `${piece.fall}px`,
              '--rot': `${piece.rot}deg`,
              '--delay': `${piece.delay}s`,
              '--dur': `${piece.duration}s`,
              '--c': piece.color,
              width: `${piece.width}px`,
              height: `${piece.height}px`,
              borderRadius: piece.round ? '999px' : '2px',
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}

const stateBadgeClass: Record<WelfareAirdrop['state'], string> = {
  upcoming: 'border-violet-400/40 bg-violet-400/10 text-violet-400',
  active: 'border-cyan-400/40 bg-cyan-400/10 text-cyan-500',
  sold_out: 'border-amber-400/40 bg-amber-400/10 text-amber-500',
  ended: 'border-muted-foreground/30 bg-muted text-muted-foreground',
  claimed: 'border-violet-400/40 bg-violet-400/10 text-violet-400',
}

const stateLabels = {
  upcoming: 'Coming soon',
  active: 'In progress',
  sold_out: 'Fully claimed',
  ended: 'Ended',
  claimed: 'Claimed',
} as const

function CampaignCard({
  campaign,
  pending,
  celebrating,
  onClaim,
}: {
  campaign: WelfareAirdrop
  pending: boolean
  celebrating: boolean
  onClaim: () => void
}) {
  const { t } = useTranslation()
  const progress = campaign.unlimited
    ? 0
    : Math.min(
        100,
        (campaign.claimedCount / Math.max(campaign.totalCount, 1)) * 100,
      )
  const status = t(stateLabels[campaign.state])
  let claimLabel = status
  if (celebrating) {
    claimLabel = t('Claimed')
  } else if (pending) {
    claimLabel = t('Claiming...')
  } else if (campaign.canClaim) {
    claimLabel = t('Claim credit')
  }
  return (
    <article className={`airdrop-glow airdrop-enter h-full flex flex-col overflow-hidden rounded-xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/10 via-background to-violet-500/10 transition-transform duration-300 hover:-translate-y-1 ${celebrating ? 'airdrop-card-celebrating' : ''}`}>
      <div className="flex items-start justify-between gap-4 p-5 pb-0">
        <div className="flex gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-cyan-500 shadow-[0_0_20px_rgba(34,211,238,0.15)]">
            <Gift className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="leading-tight font-semibold">{campaign.name}</h2>
            <p className="text-muted-foreground mt-1 line-clamp-2 text-sm leading-relaxed">
              {campaign.description ||
                t('A little extra credit, right when you need it.')}
            </p>
          </div>
        </div>
        <Badge className={stateBadgeClass[campaign.state]}>{status}</Badge>
      </div>

      <div className="grid grid-cols-3 gap-3 p-5">
        <div className="rounded-lg border bg-black/[0.02] p-3 dark:bg-white/[0.02]">
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <TicketCheck className="size-3.5" aria-hidden="true" />
            {t('Credit per claim')}
          </span>
          <strong className="mt-1.5 block font-mono text-lg text-cyan-500 dark:text-cyan-400">
            {formatQuota(campaign.quota)}
          </strong>
        </div>
        <div className="rounded-lg border bg-black/[0.02] p-3 dark:bg-white/[0.02]">
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <Package className="size-3.5" aria-hidden="true" />
            {t('Available stock')}
          </span>
          <strong className="mt-1.5 block font-mono text-lg">
            {campaign.unlimited
              ? t('Unlimited')
              : `${campaign.remaining} / ${campaign.totalCount}`}
          </strong>
        </div>
        <div className="rounded-lg border bg-black/[0.02] p-3 dark:bg-white/[0.02]">
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <Clock className="size-3.5" aria-hidden="true" />
            {t('Expiration time')}
          </span>
          <strong className="mt-1.5 block text-lg">
            {campaign.endTime
              ? formatTimestampToDate(campaign.endTime)
              : t('No expiry')}
          </strong>
        </div>
      </div>

      <div className="mt-auto px-5 pb-5">
        {!campaign.unlimited && (
          <div
            className="mb-4 h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.06]"
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span
              className="airdrop-progress-shine block h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        <Button
          className={`h-11 w-full rounded-full border-0 bg-gradient-to-r from-cyan-500 to-violet-500 text-white shadow-[0_8px_24px_-8px_rgba(34,211,238,0.45)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_-8px_rgba(139,92,246,0.55)] hover:from-cyan-400 hover:to-violet-400 disabled:opacity-50 ${pending ? 'airdrop-claim-charging' : ''} ${celebrating ? 'airdrop-claim-success' : ''}`}
          disabled={!campaign.canClaim || pending || celebrating}
          onClick={onClaim}
        >
          {celebrating ? (
            <>
              <Check className="airdrop-claim-success-icon" aria-hidden="true" />
              <span className="airdrop-claim-burst" aria-hidden="true"><i /><i /><i /><i /></span>
            </>
          ) : pending ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles aria-hidden="true" />
          )}
          {claimLabel}
        </Button>
      </div>
    </article>
  )
}

function ClaimRecord({ claim }: { claim: WelfareAirdropClaim }) {
  const { t } = useTranslation()
  const { copyToClipboard, copiedText } = useCopyToClipboard()
  const copied = copiedText === claim.redemptionKey
  return (
    <div className="flex flex-col gap-3 border-b py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-medium">{claim.airdropName}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {formatTimestampToDate(claim.createdTime)} ·{' '}
          {t('Successfully received {{quota}} credit', {
            quota: formatQuota(claim.quota),
          })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <code className="truncate rounded-md border bg-black/[0.03] px-2.5 py-1.5 font-mono text-xs dark:bg-white/[0.03]">
          {claim.redemptionKey}
        </code>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t('Copy')}
          onClick={() => void copyToClipboard(claim.redemptionKey)}
        >
          {copied ? (
            <Check className="text-cyan-500" aria-hidden="true" />
          ) : (
            <Copy aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  )
}

export function WelfareAirdrop() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [claimingId, setClaimingId] = useState<number | null>(null)
  const [celebratingId, setCelebratingId] = useState<number | null>(null)
  const [celebrationQuota, setCelebrationQuota] = useState<number | null>(null)
  useEffect(() => {
    if (celebratingId === null) return
    const timeout = window.setTimeout(() => {
      void client
        .invalidateQueries({
          queryKey: welfareAirdropQueryKeys.campaigns,
        })
        .finally(() => {
          setCelebratingId(null)
          setCelebrationQuota(null)
        })
    }, 4600)
    return () => window.clearTimeout(timeout)
  }, [celebratingId, client])
  const query = useQuery({
    queryKey: welfareAirdropQueryKeys.campaigns,
    queryFn: getWelfareAirdrops,
    retry: false,
  })
  const claimsQuery = useQuery({
    queryKey: welfareAirdropQueryKeys.claims,
    queryFn: getWelfareAirdropClaims,
    retry: false,
  })
  const mutation = useMutation({
    mutationFn: claimWelfareAirdrop,
    onMutate: (id) => setClaimingId(id),
    onSuccess: (claim, id) => {
      setCelebratingId(id)
      setCelebrationQuota(claim.quota)
      void client.invalidateQueries({
        queryKey: welfareAirdropQueryKeys.claims,
      })
    },
    onSettled: () => setClaimingId(null),
    onError: () =>
      toast.error(t('Unable to complete the claim. Please try again.')),
  })
  const campaigns = query.data ?? []
  const claims = claimsQuery.data ?? []
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        <span className="inline-flex items-center gap-2">
          <span>{t('Welfare Airdrop')}</span>
          <Badge>{t('Limited time')}</Badge>
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void query.refetch()
            void claimsQuery.refetch()
          }}
          disabled={query.isFetching || claimsQuery.isFetching}
        >
          <RefreshCw
            className={query.isFetching ? 'animate-spin' : undefined}
          />
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        {celebratingId !== null && celebrationQuota !== null && (
          <>
            <AirdropConverge />
            <AirdropConfetti />
            <div
              className="airdrop-success-overlay"
              role="status"
              aria-live="polite"
            >
              <span className="airdrop-success-halo" aria-hidden="true" />
              <span className="airdrop-success-shockwave" aria-hidden="true" />
              <div className="airdrop-success-rays" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="airdrop-success-badge" aria-hidden="true">
                <Check />
              </div>
              <div className="airdrop-success-copy">
                <strong>
                  {t(
                    'Successfully received {{quota}} credit, added to your wallet',
                    { quota: formatQuota(celebrationQuota) },
                  )}
                </strong>
              </div>
            </div>
          </>
        )}
        <div className="mx-auto w-full max-w-5xl space-y-6 py-2">
          {query.isLoading ? (
            <div className="text-cyan-500 flex justify-center py-16">
              <LoaderCircle className="size-8 animate-spin" aria-hidden="true" />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center gap-6 rounded-xl border border-dashed px-6 py-12 text-center">
              <AirdropOrb />
              <p className="text-muted-foreground max-w-md">
                {t(
                  'The next welfare drop is being prepared. Stay tuned for the launch signal.',
                )}
              </p>
            </div>
          ) : (
            <Carousel
              className="airdrop-enter w-full"
              opts={{ loop: campaigns.length > 1 }}
            >
              <CarouselContent>
                {campaigns.map((campaign) => (
                  <CarouselItem key={campaign.id}>
                    <CampaignCard
                      campaign={campaign}
                      pending={claimingId === campaign.id}
                      celebrating={celebratingId === campaign.id}
                      onClaim={() => mutation.mutate(campaign.id)}
                    />
                  </CarouselItem>
                ))}
              </CarouselContent>
              {campaigns.length > 1 && (
                <>
                  <CarouselPrevious className="-left-3 border-cyan-500/30 hover:bg-cyan-500/10 sm:-left-6" />
                  <CarouselNext className="-right-3 border-cyan-500/30 hover:bg-cyan-500/10 sm:-right-6" />
                </>
              )}
            </Carousel>
          )}

          <section className="airdrop-enter airdrop-enter-3 rounded-xl border">
            <h2 className="flex items-center gap-2 border-b px-5 py-4 font-semibold">
              <TicketCheck
                className="size-4 text-cyan-500"
                aria-hidden="true"
              />
              {t('Claim records')}
            </h2>
            <div className="px-5 py-1">
              {claimsQuery.isLoading ? (
                <div className="text-muted-foreground flex justify-center py-8">
                  <LoaderCircle
                    className="size-6 animate-spin"
                    aria-hidden="true"
                  />
                </div>
              ) : claims.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {t('No claim records yet')}
                </p>
              ) : (
                claims.map((claim) => (
                  <ClaimRecord key={claim.id} claim={claim} />
                ))
              )}
            </div>
          </section>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
