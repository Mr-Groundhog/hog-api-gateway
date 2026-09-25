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
import type {
  TokenRiskEventType,
  TokenRiskUserSummary,
} from '../api-token-risk'

export const EVENT_LABELS: Record<TokenRiskEventType, string> = {
  concurrent_fp: 'Concurrent clients',
  single_fp_concurrency: 'Gateway-level concurrency',
  fp_burst: 'Fingerprint burst',
  fp_cross_user: 'Cross-user fingerprint',
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
  fp_cross_user: {
    user_ids: 'User IDs seen with this fingerprint',
    usernames: 'Usernames seen with this fingerprint',
    user_count: 'User count',
    threshold: 'Threshold',
    ...FINGERPRINT_LABELS,
  },
}

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
    for (const detail of details) {
      for (const [detailKey, detailValue] of Object.entries(detail)) {
        rows.push({
          key: `${key}-${String(detail.fingerprint ?? '')}-${detailKey}`,
          label: labels[detailKey] ?? detailKey,
          value: String(detailValue),
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
