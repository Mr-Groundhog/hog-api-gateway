/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { formatTimestampToDate } from '@/lib/format'

import type {
  TokenRiskEventType,
  TokenRiskUserSummary,
} from '../api-token-risk'

export const EVENT_LABELS: Record<TokenRiskEventType, string> = {
  concurrent_fp: 'Concurrent clients',
  single_fp_concurrency: 'Gateway-level concurrency',
  fp_burst: 'Fingerprint burst',
  ip_burst: 'Source IP burst',
  fp_cross_user: 'Cross-user fingerprint',
}

/**
 * 各信号的含义说明（英文即 i18n 键）。信号含义是管理员判断证据的前提，因此由这张表
 * 统一提供：分发信号列表头的提示与证据弹窗中每个信号的说明都取这里，避免两处文案分叉。
 * 键顺序即列表头的展示顺序。
 */
export const EVENT_DESCRIPTIONS: Record<TokenRiskEventType, string> = {
  concurrent_fp:
    'The same API key is being used by several different apps or devices at the same time.',
  single_fp_concurrency:
    'A single client is sending an unusually high number of simultaneous requests, typical of a reseller forwarding traffic through their own gateway.',
  fp_burst:
    'Many different clients appeared on the same key within one day, suggesting the key was shared with many people.',
  ip_burst:
    'One key was used from many different source IPs within one day. A key kept for personal use comes from one or two networks, so a wide spread is what a resold key looks like. IPv6 addresses count as one network per /64 prefix, and a source only counts after repeated requests.',
  fp_cross_user:
    'One client configuration used by several accounts from the same source address on the same day. The same client software alone is common and is not treated as sharing; the shared source address is what makes the accounts related.',
}

// 客户端指纹的通用证据字段：指纹本身与它对应的客户端软件标识
const FINGERPRINT_LABELS: Record<string, string> = {
  fingerprint: 'Fingerprint',
  user_agent: 'Client user agent',
  client_version: 'Client version',
  platform: 'Client platform',
}

// 事件类型 → 证据字段中人类可读的说明片段
const EVIDENCE_LABELS: Record<string, Record<string, string>> = {
  concurrent_fp: {
    concurrent_fingerprints: 'Distinct concurrent client fingerprints',
    threshold: 'Threshold',
    fingerprints: 'In-flight fingerprints',
    requests: 'In-flight requests',
    ...FINGERPRINT_LABELS,
  },
  single_fp_concurrency: {
    single_fp_inflight: 'In-flight requests from one fingerprint',
    threshold: 'Threshold',
    ...FINGERPRINT_LABELS,
  },
  fp_burst: {
    distinct_fingerprints: 'Distinct fingerprints in one day',
    valid_fingerprints: 'Fingerprints with repeated requests',
    threshold: 'Threshold',
    fingerprints: 'Fingerprints with the most requests',
    requests: 'Requests in one day',
    ...FINGERPRINT_LABELS,
  },
  ip_burst: {
    distinct_source_networks: 'Distinct source IPs in one day',
    valid_source_networks: 'Source IPs with repeated requests',
    threshold: 'Threshold',
    source_networks: 'Source IPs with the most requests',
    network: 'Source IP',
    requests: 'Requests in one day',
  },
  fp_cross_user: {
    source_ip: 'Source IP',
    accounts: 'Accounts sharing this fingerprint',
    user_id: 'User ID',
    username: 'Username',
    token_id: 'Token ID',
    requests: 'Requests in one day',
    first_seen: 'First request time',
    last_seen: 'Last request time',
    // 历史事件按 user_ids / usernames 记录账号，仍按原样展示，不隐藏旧证据。
    user_ids: 'User IDs seen with this fingerprint',
    usernames: 'Usernames seen with this fingerprint',
    user_count: 'User count',
    threshold: 'Threshold',
    ...FINGERPRINT_LABELS,
  },
}

/** 证据中按时间展示的字段：值是 Unix 秒，展示原始数字无法核对请求发生的时刻。 */
const EVIDENCE_TIMESTAMP_KEYS = new Set(['first_seen', 'last_seen'])

type EvidenceRow = {
  key: string
  label: string
  value: string
  /** 分组标题：只展示标签，不展示值。 */
  header?: boolean
  /** 指纹等哈希值用等宽字体展示。 */
  mono?: boolean
}

export type EvidenceBlock = {
  type: TokenRiskEventType
  rows: EvidenceRow[]
}

/**
 * 解析事件证据 JSON 为展示行。指纹明细（对象数组）展开为"分组标题 + 每条明细"，普通
 * 数组逗号拼接；解析失败时回退显示原始文本，不静默隐藏证据——证据格式异常时管理员
 * 仍需看到原始内容。
 */
function parseEvidenceRows(eventType: string, evidence: string): EvidenceRow[] {
  if (evidence === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(evidence)
  } catch {
    return [{ key: 'raw', label: '', value: evidence }]
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return [{ key: 'raw', label: '', value: evidence }]
  }

  const labels = EVIDENCE_LABELS[eventType] ?? {}
  const rows: EvidenceRow[] = []
  for (const [key, value] of Object.entries(parsed)) {
    const label = labels[key] ?? key
    const items = Array.isArray(value) ? value : null
    const details = items?.filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null
    )
    if (!details || details.length === 0) {
      const text = items
        ? items
            .map((item) => String(item))
            .filter((item) => item !== '')
            .join(', ')
        : String(value)
      rows.push({ key, label, value: text, mono: key === 'fingerprint' })
      continue
    }
    rows.push({ key, label, value: '', header: true })
    for (const [index, detail] of details.entries()) {
      for (const [detailKey, detailValue] of Object.entries(detail)) {
        const text = String(detailValue)
        const seconds = Number(text)
        // 明细里的时间字段按本地时间展示，缺失或非法时保留原值，不隐藏证据。
        const showAsTime =
          EVIDENCE_TIMESTAMP_KEYS.has(detailKey) && Number.isFinite(seconds)
        rows.push({
          key: `${key}-${index}-${detailKey}`,
          label: labels[detailKey] ?? detailKey,
          value: showAsTime ? formatTimestampToDate(seconds) : text,
          mono: detailKey === 'fingerprint',
        })
      }
    }
  }
  return rows
}

/**
 * 汇总一个用户的全部证据块。除最新一条事件的证据外，还会补齐其它信号类型的最新证据，
 * 避免最新事件不是 fp_cross_user 时看不到关联账号。
 */
export function buildEvidenceBlocks(
  summary: TokenRiskUserSummary
): EvidenceBlock[] {
  const latestType = summary.latest_event_type
  const blocks: EvidenceBlock[] = [
    {
      type: latestType,
      rows: parseEvidenceRows(latestType, summary.latest_evidence),
    },
  ]
  for (const signal of summary.signals) {
    if (signal.event_type === latestType) continue
    blocks.push({
      type: signal.event_type,
      rows: parseEvidenceRows(signal.event_type, signal.evidence),
    })
  }
  return blocks.filter((block) => block.rows.length > 0)
}

/**
 * 生成证据列的单行摘要：每个证据块只取分组标题之前的标量字段，指纹明细留在弹窗里展开，
 * 避免证据变多时把表格行撑高。多个信号同时命中时在摘要前标注信号名，保证跨账号证据
 * 不会因为在表格中被折叠而完全看不到。
 */
export function formatEvidencePreview(
  blocks: EvidenceBlock[],
  translate: (key: string) => string
): string {
  const parts: string[] = []
  for (const block of blocks) {
    const label = translate(EVENT_LABELS[block.type])
    const segments: string[] = []
    for (const row of block.rows) {
      if (row.header) break
      segments.push(
        row.label === '' ? row.value : `${translate(row.label)}: ${row.value}`
      )
    }
    if (segments.length === 0) {
      parts.push(label)
      continue
    }
    const text = segments.join(' · ')
    parts.push(blocks.length > 1 ? `${label} — ${text}` : text)
  }
  return parts.join(' · ')
}
