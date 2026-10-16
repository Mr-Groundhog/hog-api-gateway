/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
export const DEFAULT_PAGE_SIZE = 20

/** 延迟着色阈值（毫秒）。 */
export const PROXY_LATENCY = {
  fastMs: 500,
  slowMs: 2000,
} as const

/** 导入文本的大小与行数上限，与后端校验保持一致。 */
export const PROXY_IMPORT_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  maxLines: 20000,
} as const
