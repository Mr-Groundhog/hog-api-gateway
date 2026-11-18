/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

export const GAME_WIDTH = 900
export const GAME_HEIGHT = 540
export const GAME_DURATION = 40
export const MAX_SCORE = 9999
const STEP_MS = 20

export type Coin = {
  x: number
  y: number
  value: number
  r: number
  phase: number
  alive: boolean
}
export type Item = {
  x: number
  y: number
  r: number
  type: 'magnet' | 'smoke' | 'double'
  phase: number
  life: number
  gone: boolean
}
export type Patrol = {
  x: number
  y: number
  r: number
  axis: 'x' | 'y'
  center: number
  range: number
  speed: number
  phase: number
}
export type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  r: number
  color: string
}
export type Player = {
  x: number
  y: number
  tx: number
  ty: number
  r: number
  inv: number
}
export type ServerGame = {
  randomState: number
  player: Player
  coins: Coin[]
  items: Item[]
  patrols: Patrol[]
  score: number
  coinsCollected: number
  elapsedMs: number
  combo: number
  comboUntil: number
  magnetT: number
  smokeT: number
  multT: number
  caughtT: number
  notice: string
  noticeT: number
  noticePoints: number
  spawnAt: number
  itemAt: number
}
export type GameSnapshot = {
  mode: 'ready' | 'playing' | 'settling' | 'over'
  score: number
  seconds: number
  multiplier: number
  status: 'safe' | 'caught' | 'smoke' | 'magnet'
  coinsCollected: number
}
export type GameRound = {
  round_id: string
  game_day: string
  display_name: string
  status: 1 | 2
  score: number
  reward_cents: number
  quota: number
  sequence: number
  started_at: number
  settled_at: number
  top_up_id: number
}
export type GameView = {
  round: GameRound | null
  game?: ServerGame
  server_time: number
  reward_amount: string
}
export type PlayerRanking = {
  round_id: string
  display_name: string
  score: number
}

export type GameMovement = { elapsed_ms: number; x: number; y: number }

/** Local gameplay; the server independently replays movement at settlement. */
export class CoinCaptureGame {
  mode: GameSnapshot['mode'] = 'ready'
  player: Player = { x: 450, y: 270, tx: 450, ty: 270, r: 12, inv: 0 }
  coins: Coin[] = []
  items: Item[] = []
  patrols: Patrol[] = []
  particles: Particle[] = []
  score = 0
  coinsCollected = 0
  elapsed = 0
  combo = 0
  magnetT = 0
  smokeT = 0
  multT = 0
  caughtT = 0
  notice = ''
  noticeT = 0
  noticePoints = 0
  visualPlayer: Player = { ...this.player }
  movements: GameMovement[] = []
  private clockAt = 0
  private clockElapsed = 0
  private lastFrame = 0
  private fixedElapsed = 0
  private randomState = 0
  private comboUntil = 0
  private spawnAt = 0
  private itemAt = 0
  private previousPlayer = { x: 450, y: 270 }

  apply(view: GameView, now: number): void {
    this.clockAt = this.lastFrame = now
    if (!view.round) {
      this.mode = 'ready'
      return
    }
    if (view.round.status === 2) {
      this.mode = 'over'
      this.elapsed = GAME_DURATION
      this.score = view.round.score
      return
    }
    const state = view.game
    if (!state) return
    this.mode = 'playing'
    this.player = { ...state.player }
    this.previousPlayer = { x: state.player.x, y: state.player.y }
    this.coins = state.coins.map((coin) => ({ ...coin }))
    this.items = state.items.map((item) => ({ ...item }))
    this.patrols = state.patrols.map((patrol) => ({ ...patrol }))
    this.particles = []
    this.movements = []
    this.randomState = state.randomState || 0x6d2b79f5
    this.fixedElapsed = state.elapsedMs
    this.score = state.score
    this.coinsCollected = state.coinsCollected
    this.combo = state.combo
    this.comboUntil = state.comboUntil
    this.magnetT = state.magnetT
    this.smokeT = state.smokeT
    this.multT = state.multT
    this.caughtT = state.caughtT
    this.notice = state.notice
    this.noticeT = state.noticeT
    this.noticePoints = state.noticePoints
    this.spawnAt = state.spawnAt
    this.itemAt = state.itemAt
    this.clockElapsed = Math.min(
      GAME_DURATION * 1000,
      Math.max(0, view.server_time - view.round.started_at)
    )
    // Time spent loading starts with the server's initial stationary target.
    this.advance(
      this.clockElapsed,
      { x: this.player.tx, y: this.player.ty },
      false
    )
    this.elapsed = this.clockElapsed / 1000
    this.visualPlayer = { ...this.player }
    if (this.elapsed >= GAME_DURATION) this.mode = 'settling'
  }

  predict(now: number, target: { x: number; y: number }): void {
    if (this.mode !== 'playing') return
    const dt = Math.min(0.04, Math.max(0, (now - this.lastFrame) / 1000))
    this.lastFrame = now
    const elapsedMS = Math.min(
      GAME_DURATION * 1000,
      this.clockElapsed + Math.max(0, now - this.clockAt)
    )
    this.advance(elapsedMS, target, true)
    this.elapsed = elapsedMS / 1000
    const alpha = Math.min(1, (elapsedMS - this.fixedElapsed) / STEP_MS)
    this.visualPlayer = {
      ...this.player,
      x:
        this.previousPlayer.x + (this.player.x - this.previousPlayer.x) * alpha,
      y:
        this.previousPlayer.y + (this.player.y - this.previousPlayer.y) * alpha,
    }
    const drag = Math.pow(0.1, dt)
    for (const particle of this.particles) {
      particle.x += particle.vx * dt
      particle.y += particle.vy * dt
      particle.vx *= drag
      particle.vy *= drag
      particle.life -= dt
    }
    this.particles = this.particles.filter((particle) => particle.life > 0)
    if (this.elapsed >= GAME_DURATION) {
      this.visualPlayer = { ...this.player }
      this.mode = 'settling'
    }
  }

  private randomBetween(low: number, high: number): number {
    let state = this.randomState
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    this.randomState = state >>> 0
    return low + (this.randomState / 4294967296) * (high - low)
  }

  private addCoin(x: number, y: number): void {
    const coin: Coin = {
      x,
      y,
      value: 1,
      r: 9,
      phase: this.randomBetween(0, 7),
      alive: true,
    }
    if (this.randomBetween(0, 1) < 0.13) {
      coin.value = 3
      coin.r = 12
    }
    this.coins.push(coin)
  }

  private pop(x: number, y: number, color: string, count: number): void {
    const limit = Math.min(count, 180 - this.particles.length)
    for (let i = 0; i < limit; i++) {
      // Decorative randomness is independent of replay randomness.
      const angle = Math.random() * Math.PI * 2
      const speed = 20 + Math.random() * 95
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.25 + Math.random() * 0.4,
        max: 0.65,
        r: 1.5 + Math.random() * 2.2,
        color,
      })
    }
  }

  private advance(
    elapsedMS: number,
    target: { x: number; y: number },
    record: boolean
  ): void {
    while (this.fixedElapsed + STEP_MS <= elapsedMS) {
      if (target.x !== this.player.tx || target.y !== this.player.ty) {
        if (record) {
          this.movements.push({ elapsed_ms: this.fixedElapsed, ...target })
        }
        this.player.tx = target.x
        this.player.ty = target.y
      }
      this.previousPlayer = { x: this.player.x, y: this.player.y }
      this.fixedElapsed += STEP_MS
      this.step()
    }
  }

  private step(): void {
    const dt = STEP_MS / 1000
    this.magnetT = Math.max(0, this.magnetT - dt)
    this.smokeT = Math.max(0, this.smokeT - dt)
    this.multT = Math.max(0, this.multT - dt)
    this.caughtT = Math.max(0, this.caughtT - dt)
    this.noticeT = Math.max(0, this.noticeT - dt)
    this.player.inv = Math.max(0, this.player.inv - dt)
    if (this.fixedElapsed > this.comboUntil) this.combo = 0
    const dx = this.player.tx - this.player.x
    const dy = this.player.ty - this.player.y
    const distance = Math.hypot(dx, dy)
    if (distance > 1) {
      const travel = Math.min(distance, 480 * dt)
      this.player.x += (dx / distance) * travel
      this.player.y += (dy / distance) * travel
    }
    if (this.fixedElapsed >= this.spawnAt && this.coins.length < 48) {
      this.spawnAt = this.fixedElapsed + 1160
      const count = this.randomBetween(0, 1) < 0.2 ? 3 : 2
      for (let i = 0; i < count; i++) {
        this.addCoin(
          this.randomBetween(35, GAME_WIDTH - 35),
          this.randomBetween(35, GAME_HEIGHT - 35)
        )
      }
    }
    if (this.fixedElapsed >= this.itemAt && this.items.length < 2) {
      this.itemAt =
        this.fixedElapsed + Math.floor(this.randomBetween(7000, 11000))
      const x = this.randomBetween(45, GAME_WIDTH - 45)
      const y = this.randomBetween(45, GAME_HEIGHT - 45)
      const types = ['magnet', 'smoke', 'double'] as const
      const type = types[Math.floor(this.randomBetween(0, 3))]
      this.items.push({
        x,
        y,
        r: 12,
        type,
        phase: this.randomBetween(0, 7),
        life: 10,
        gone: false,
      })
    }
    const seconds = this.fixedElapsed / 1000
    for (const patrol of this.patrols) {
      const wave = Math.sin(seconds * patrol.speed + patrol.phase)
      if (patrol.axis === 'x') {
        patrol.x = patrol.center + wave * patrol.range
        patrol.y = 145 + ((patrol.phase * 57) % 270)
      } else {
        patrol.y = patrol.center + wave * patrol.range
        patrol.x = 140 + ((patrol.phase * 139) % 620)
      }
    }
    const alive: Coin[] = []
    for (const coin of this.coins) {
      let proximity = Math.hypot(coin.x - this.player.x, coin.y - this.player.y)
      if (this.magnetT > 0 && proximity < 110) {
        const divisor = Math.max(1, proximity)
        coin.x += ((this.player.x - coin.x) / divisor) * 220 * dt
        coin.y += ((this.player.y - coin.y) / divisor) * 220 * dt
        proximity = Math.hypot(coin.x - this.player.x, coin.y - this.player.y)
      }
      const radius = this.player.r + coin.r + (this.magnetT > 0 ? 5 : 0)
      if (proximity >= radius || (distance <= 9 && this.magnetT <= 0)) {
        alive.push(coin)
        continue
      }
      this.coinsCollected++
      this.combo = this.fixedElapsed < this.comboUntil ? this.combo + 1 : 1
      this.comboUntil = this.fixedElapsed + 2500
      const base = coin.value === 3 ? 50 : 10
      const points = Math.round(
        base * this.snapshot().multiplier * (this.magnetT > 0 ? 1.25 : 1)
      )
      const previous = this.score
      this.score = Math.min(MAX_SCORE, this.score + points)
      this.noticePoints = this.score - previous
      this.notice = 'points'
      this.noticeT = 0.9
      this.pop(
        coin.x,
        coin.y,
        coin.value === 3 ? '#fff0ad' : '#f4d47b',
        coin.value === 3 ? 18 : 11
      )
    }
    this.coins = alive
    const remaining: Item[] = []
    for (const item of this.items) {
      item.life -= dt
      if (item.life <= 0) continue
      if (
        Math.hypot(item.x - this.player.x, item.y - this.player.y) >=
        this.player.r + item.r + 5
      ) {
        remaining.push(item)
        continue
      }
      let color = '#d9afff'
      if (item.type === 'magnet') {
        this.magnetT = 6
        color = '#bce8ef'
      } else if (item.type === 'smoke') {
        this.smokeT = 5
        color = '#c1c8c5'
      } else this.multT = 6
      this.notice = item.type
      this.noticeT = 0.9
      this.pop(item.x, item.y, color, 18)
    }
    this.items = remaining
    for (const patrol of this.patrols) {
      if (
        Math.hypot(patrol.x - this.player.x, patrol.y - this.player.y) <
          patrol.r + this.player.r + 5 &&
        this.player.inv <= 0 &&
        this.smokeT <= 0
      ) {
        this.caughtT = 0.7
        this.player.inv = 1.1
        this.combo = this.comboUntil = 0
        this.notice = 'caught'
        this.noticeT = 1.2
        this.pop(this.player.x, this.player.y, '#f2a07d', 14)
      }
    }
  }

  snapshot(): GameSnapshot {
    let multiplier = 1
    if (this.multT > 0) multiplier = 2
    else if (this.combo >= 20) multiplier = 3
    else if (this.combo >= 10) multiplier = 2
    else if (this.combo >= 5) multiplier = 1.5
    let status: GameSnapshot['status'] = 'safe'
    if (this.caughtT > 0) status = 'caught'
    else if (this.smokeT > 0) status = 'smoke'
    else if (this.magnetT > 0) status = 'magnet'
    return {
      mode: this.mode,
      score: this.score,
      seconds: Math.ceil(GAME_DURATION - this.elapsed),
      multiplier,
      status,
      coinsCollected: this.coinsCollected,
    }
  }
}
