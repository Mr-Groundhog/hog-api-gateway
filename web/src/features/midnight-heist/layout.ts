/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

export function fitCoinCaptureBoard(
  width: number,
  height: number
): {
  gameWidth: number
  rankingWidth: number
  gap: number
  height: number
} {
  const gap = width < 640 ? 8 : 16
  const rankingWidth = Math.min(width * 0.3, width < 640 ? 156 : 260)
  // Reserve the HUD, controls and panel padding before sizing the 5:3 arena.
  const gameWidth = Math.max(
    0,
    Math.min(width - rankingWidth - gap, ((height - 120) * 5) / 3 + 18, 918)
  )
  return {
    gameWidth,
    rankingWidth,
    gap,
    height: Math.max(0, Math.min(height, ((gameWidth - 18) * 3) / 5 + 120)),
  }
}
