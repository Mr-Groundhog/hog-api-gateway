/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import {
  GAME_WIDTH as W,
  GAME_HEIGHT as H,
  type Coin,
  type Item,
  type Patrol,
  type CoinCaptureGame,
} from './game'

/** Canvas artwork retained from mouse-thief-60s.html. */
export class HeistRenderer {
  private ctx: CanvasRenderingContext2D
  private backdrop: HTMLCanvasElement | null = null
  private coinSprites = new Map<number, HTMLCanvasElement>()

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx
    const backdrop = document.createElement('canvas')
    backdrop.width = W
    backdrop.height = H
    const backdropContext = backdrop.getContext('2d', { alpha: false })
    if (backdropContext) {
      this.ctx = backdropContext
      this.paintBackground()
      this.backdrop = backdrop
    }
    // Rasterize the coin text and blurred glow once, avoiding repeated
    // shadow and font work for every coin on every animation frame.
    for (const value of [1, 3]) {
      const sprite = document.createElement('canvas')
      sprite.width = sprite.height = 80
      const spriteContext = sprite.getContext('2d')
      if (!spriteContext) continue
      this.ctx = spriteContext
      this.paintCoin(
        { x: 40, y: 40, value, r: value === 3 ? 12 : 9, phase: 0, alive: true },
        0
      )
      this.coinSprites.set(value, sprite)
    }
    this.ctx = ctx
  }
  private paintBackground(): void {
    const ctx = this.ctx
    const g = ctx.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, '#253026')
    g.addColorStop(0.52, '#1b251f')
    g.addColorStop(1, '#151d1d')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = 'rgba(221,211,166,.07)'
    ctx.lineWidth = 1
    for (let x = 0; x <= W; x += 36) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, H)
      ctx.stroke()
    }
    for (let y = 0; y <= H; y += 36) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(W, y)
      ctx.stroke()
    }
    // subtle room walls and shelves
    ctx.strokeStyle = 'rgba(213,194,137,.19)'
    ctx.lineWidth = 3
    ctx.strokeRect(14, 14, W - 28, H - 28)
    for (let i = 0; i < 5; i++) {
      const px = 80 + i * 170
      ctx.fillStyle = 'rgba(200,179,125,.08)'
      ctx.fillRect(px, 30, 72, 8)
      ctx.fillRect(px + 11, H - 42, 80, 7)
    }
    for (let i = 0; i < 12; i++) {
      const px = (i * 173 + 27) % W
      const py = (i * 97 + 33) % H
      ctx.fillStyle = 'rgba(227,213,157,.12)'
      ctx.beginPath()
      ctx.arc(px, py, 1.4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  private drawCoin(c: Coin, t: number): void {
    const sprite = this.coinSprites.get(c.value)
    if (!sprite) {
      this.paintCoin(c, t)
      return
    }
    const bob = Math.sin(t * 3 + c.phase) * 2.5
    this.ctx.drawImage(sprite, c.x - 40, c.y + bob - 40)
  }
  private paintCoin(c: Coin, t: number): void {
    const ctx = this.ctx
    const bob = Math.sin(t * 3 + c.phase) * 2.5
    const r = c.r
    ctx.save()
    ctx.translate(c.x, c.y + bob)
    ctx.shadowColor = '#efc75e'
    ctx.shadowBlur = c.value === 3 ? 17 : 10
    ctx.fillStyle = c.value === 3 ? '#ffe28b' : '#d9ad4e'
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.strokeStyle = '#fff0bb'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(0, 0, r - 3, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#70541d'
    ctx.font = `bold ${c.value === 3 ? 12 : 10}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(c.value === 3 ? '★' : '$', 0, 1)
    ctx.restore()
  }
  private drawItem(it: Item, t: number): void {
    const ctx = this.ctx
    let color = '#c8a0f1'
    let label = '×2'
    if (it.type === 'magnet') {
      color = '#9fd9e3'
      label = 'M'
    } else if (it.type === 'smoke') {
      color = '#c1cac4'
      label = 'S'
    }
    ctx.save()
    ctx.translate(it.x, it.y)
    ctx.rotate(Math.sin(t * 2 + it.phase) * 0.12)
    ctx.shadowColor = color
    ctx.shadowBlur = 13
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.fillStyle = '#1e2926'
    ctx.beginPath()
    ctx.arc(0, 0, it.r + Math.sin(t * 3 + it.phase) * 1.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = color
    ctx.font = 'bold 11px system-ui'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, 0, 1)
    ctx.restore()
  }
  private drawPatrol(p: Patrol, t: number): void {
    const ctx = this.ctx
    ctx.save()
    ctx.translate(p.x, p.y)
    const radius = p.r + Math.sin(t * 4 + p.phase) * 2
    ctx.fillStyle = 'rgba(255,226,152,.08)'
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, 105, -0.75, 0.75)
    ctx.closePath()
    ctx.fill()
    const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, radius + 13)
    grad.addColorStop(0, '#fff7cc')
    grad.addColorStop(0.22, '#ffe6a1')
    grad.addColorStop(1, 'rgba(255,202,106,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(0, 0, radius + 13, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffe8aa'
    ctx.beginPath()
    ctx.arc(0, 0, radius * 0.48, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  private drawPlayer(game: CoinCaptureGame, t: number): void {
    const ctx = this.ctx
    const { visualPlayer: player, smokeT } = game
    ctx.save()
    ctx.translate(player.x, player.y)
    if (smokeT > 0) {
      ctx.globalAlpha = 0.62
      ctx.fillStyle = 'rgba(192,203,200,.2)'
      ctx.beginPath()
      ctx.arc(0, 0, 30 + Math.sin(t * 5) * 3, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.shadowColor = '#c8d0ab'
    ctx.shadowBlur = 12
    ctx.fillStyle = player.inv > 0 ? '#f6c8a0' : '#d2d4b6'
    ctx.beginPath()
    ctx.arc(0, 0, player.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#30382e'
    ctx.beginPath()
    ctx.arc(0, 0, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff5d9'
    ctx.beginPath()
    ctx.arc(-2, -2, 1.8, 0, Math.PI * 2)
    ctx.arc(3, -2, 1.8, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  draw(game: CoinCaptureGame, notice: string): void {
    const ctx = this.ctx
    const {
      visualPlayer: player,
      magnetT,
      coins,
      items,
      patrols,
      particles,
      noticeT,
      elapsed,
    } = game
    const t = elapsed
    if (this.backdrop) ctx.drawImage(this.backdrop, 0, 0)
    else this.paintBackground()
    if (magnetT > 0) {
      ctx.strokeStyle = 'rgba(156,220,224,.22)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(player.x, player.y, 90, 0, Math.PI * 2)
      ctx.stroke()
    }
    for (const c of coins) if (c.alive) this.drawCoin(c, t)
    for (const it of items) if (!it.gone) this.drawItem(it, t)
    for (const p of patrols) this.drawPatrol(p, t)
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max))
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    this.drawPlayer(game, t)
    if (noticeT > 0) {
      ctx.globalAlpha = Math.max(0, Math.min(1, noticeT / 0.3))
      ctx.fillStyle = '#fff0c1'
      ctx.font = 'bold 17px system-ui'
      ctx.textAlign = 'center'
      ctx.fillText(notice, player.x, player.y - 24)
      ctx.globalAlpha = 1
    }
  }
}
