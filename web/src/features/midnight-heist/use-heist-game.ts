/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getSelf } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { useAuthStore } from '@/stores/auth-store'

import {
  GAME_QUERY_KEY,
  RANKING_QUERY_KEY,
  getGameStatus,
  settleGame,
  startGame,
} from './api'
import {
  CoinCaptureGame,
  GAME_HEIGHT,
  GAME_WIDTH,
  type GameSnapshot,
  type GameView,
} from './game'
import { HeistRenderer } from './renderer'

export function useHeistGame() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: GAME_QUERY_KEY,
    queryFn: ({ signal }) => getGameStatus(signal),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    meta: { errorToast: false },
  })
  const startMutation = useMutation({
    mutationFn: startGame,
    onSuccess: (view) => client.setQueryData(GAME_QUERY_KEY, view),
    meta: { errorToast: false },
  })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const translateRef = useRef(t)
  const controlsRef = useRef<{
    receive: (view: GameView) => void
    draw: () => void
    finish: () => Promise<void>
  } | null>(null)
  const targetRef = useRef({ x: 450, y: 270 })
  const [available, setAvailable] = useState(false)
  const [settlementError, setSettlementError] = useState<unknown>(null)
  const [rewardAmount, setRewardAmount] = useState('0.00')
  const [snapshot, setSnapshot] = useState<GameSnapshot>({
    mode: 'ready',
    score: 0,
    seconds: 40,
    multiplier: 1,
    status: 'safe',
    coinsCollected: 0,
  })

  useEffect(() => {
    translateRef.current = t
    controlsRef.current?.draw()
  }, [t])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (!ctx) return
    const game = new CoinCaptureGame()
    const renderer = new HeistRenderer(ctx)
    const abort = new AbortController()
    let current: GameView | null = null
    let raf: number | null = null
    let disposed = false
    let settling = false
    let previous = game.snapshot()

    function draw(): void {
      const t = translateRef.current
      let notice = ''
      switch (game.notice) {
        case 'points':
          notice = `+${game.noticePoints}`
          break
        case 'magnet':
          notice = t('Magnet: collection range increased')
          break
        case 'smoke':
          notice = t('Smoke: patrols cannot detect you')
          break
        case 'double':
          notice = t('Multiplier gem: double points')
          break
        case 'caught':
          notice = t('Caught by a patrol! Combo reset')
          break
      }
      renderer.draw(game, notice)
    }

    function publish(): void {
      const next = game.snapshot()
      if (
        next.mode !== previous.mode ||
        next.score !== previous.score ||
        next.seconds !== previous.seconds ||
        next.multiplier !== previous.multiplier ||
        next.status !== previous.status ||
        next.coinsCollected !== previous.coinsCollected
      ) {
        previous = next
        setSnapshot(next)
      }
    }

    async function finish(): Promise<void> {
      if (disposed || settling || game.mode !== 'settling' || !current?.round) {
        return
      }
      settling = true
      setSettlementError(null)
      try {
        // Only bounded movement is submitted. The backend derives the final
        // score and quota from its own initial state and game rules.
        const view = await settleGame(
          current.round.round_id,
          game.movements,
          abort.signal
        )
        if (disposed) return
        controlsRef.current?.receive(view)
        client.setQueryData(GAME_QUERY_KEY, view)
        void client.invalidateQueries({ queryKey: RANKING_QUERY_KEY })
        void getSelf()
          .then((response) => {
            if (response.success && response.data) {
              useAuthStore.getState().auth.setUser(response.data)
            }
          })
          .catch((error: unknown) => handleServerError(error))
      } catch (error) {
        if (!disposed) setSettlementError(error)
      } finally {
        settling = false
      }
    }

    function frame(now: number): void {
      raf = null
      game.predict(now, targetRef.current)
      publish()
      draw()
      if (game.mode === 'playing') raf = requestAnimationFrame(frame)
      else if (game.mode === 'settling') void finish()
    }

    controlsRef.current = {
      draw,
      finish,
      receive: (view) => {
        // A cached status response must not restart an active local round.
        if (
          current?.round?.round_id === view.round?.round_id &&
          view.round?.status === 1 &&
          game.mode !== 'ready'
        ) {
          return
        }
        current = view
        game.apply(view, performance.now())
        if (view.round?.status === 2) setRewardAmount(view.reward_amount)
        if (view.game && game.mode === 'playing') {
          targetRef.current = { x: view.game.player.tx, y: view.game.player.ty }
          canvas?.focus({ preventScroll: true })
        }
        publish()
        draw()
        if (game.mode === 'playing' && raf === null) {
          raf = requestAnimationFrame(frame)
        } else if (game.mode === 'settling') void finish()
        else if (game.mode === 'over' && raf !== null) {
          cancelAnimationFrame(raf)
          raf = null
        }
      },
    }
    setAvailable(true)
    draw()
    return () => {
      disposed = true
      abort.abort()
      if (raf !== null) cancelAnimationFrame(raf)
      controlsRef.current = null
    }
  }, [client])

  useEffect(() => {
    if (query.data) controlsRef.current?.receive(query.data)
  }, [query.data])

  function moveTo(x: number, y: number): void {
    targetRef.current = {
      x: Math.max(27, Math.min(GAME_WIDTH - 27, x)),
      y: Math.max(27, Math.min(GAME_HEIGHT - 27, y)),
    }
  }

  return {
    canvasRef,
    available,
    snapshot,
    rewardAmount,
    moveTo,
    moveBy: (dx: number, dy: number) =>
      moveTo(targetRef.current.x + dx, targetRef.current.y + dy),
    start: () => startMutation.mutate(),
    starting: startMutation.isPending,
    loading: query.isPending,
    error: settlementError ?? query.error ?? startMutation.error,
    retry: () => {
      if (snapshot.mode === 'settling') {
        void controlsRef.current?.finish()
        return
      }
      startMutation.reset()
      void query.refetch()
    },
  }
}
