/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { api, type ApiRequestConfig } from '@/lib/api'
import {
  createServerError,
  getServerErrorStatus,
  requireServerSuccess,
} from '@/lib/server-error-message'

import type { GameMovement, GameView, PlayerRanking } from './game'

type Response<T> = { success: boolean; message: string; data: T }
const headers = { 'X-Coin-Capture': '1' }
export const GAME_QUERY_KEY = ['coin-capture', 'status'] as const
export const RANKING_QUERY_KEY = ['coin-capture', 'leaderboard'] as const

async function requestGame<T>(
  url: string,
  config: ApiRequestConfig
): Promise<T> {
  try {
    const response = await api.request<Response<T>>({
      ...config,
      url,
      skipBusinessError: true,
      skipErrorHandler: true,
    })
    if (
      typeof response.data !== 'object' ||
      response.data === null ||
      typeof response.data.success !== 'boolean'
    ) {
      throw createServerError({
        message_key:
          'The game service is unavailable. Update and restart the backend, then retry.',
      })
    }
    const body = requireServerSuccess(response.data)
    if (body.data === undefined) {
      throw createServerError({
        message_key:
          'The game service returned an invalid response. Please retry.',
      })
    }
    return body.data
  } catch (error) {
    if (getServerErrorStatus(error) === 404) {
      throw createServerError({
        message_key:
          'The game service is unavailable. Update and restart the backend, then retry.',
        cause: error,
      })
    }
    throw error
  }
}

export async function getGameStatus(signal?: AbortSignal): Promise<GameView> {
  return requestGame('/api/coin-capture/status', { method: 'GET', signal })
}

export async function getPlayerRankings(
  signal?: AbortSignal
): Promise<PlayerRanking[]> {
  return requestGame('/api/coin-capture/leaderboard', { method: 'GET', signal })
}

export async function startGame(): Promise<GameView> {
  return requestGame('/api/coin-capture/start', {
    method: 'POST',
    data: {},
    headers,
  })
}

export async function settleGame(
  roundId: string,
  movements: GameMovement[],
  signal: AbortSignal
): Promise<GameView> {
  return requestGame('/api/coin-capture/settle', {
    method: 'POST',
    data: { round_id: roundId, movements },
    headers,
    signal,
  })
}
