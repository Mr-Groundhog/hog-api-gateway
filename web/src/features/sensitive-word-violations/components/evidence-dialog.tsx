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
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { cn } from '@/lib/utils'

import type { TokenRiskUserSummary } from '../api-token-risk'
import { buildEvidenceBlocks, EVENT_LABELS } from '../lib/evidence'

/**
 * 证据详情弹窗：完整展示各信号命中的证据字段，包含表格里被折叠成一行摘要的指纹明细。
 */
export function EvidenceDialog(props: {
  summary: TokenRiskUserSummary | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const summary = props.summary
  const blocks = summary === null ? [] : buildEvidenceBlocks(summary)
  return (
    <Dialog
      open={summary !== null}
      onOpenChange={(open) => !open && props.onClose()}
      title={t('Evidence')}
      description={
        summary === null
          ? undefined
          : `${summary.username || `#${summary.user_id}`} · ${t(EVENT_LABELS[summary.latest_event_type])}`
      }
      bodyClassName='space-y-4'
    >
      {blocks.length === 0 && <p className='text-muted-foreground'>-</p>}
      {blocks.map((block) => (
        <div key={block.type} className='space-y-1.5'>
          <div className='font-medium'>{t(EVENT_LABELS[block.type])}</div>
          <div className='bg-muted/40 space-y-1 rounded-md border p-3'>
            {block.rows.map((row) =>
              row.header ? (
                <div
                  key={row.key}
                  className='text-muted-foreground mt-2 text-xs font-medium first:mt-0'
                >
                  {t(row.label)}
                </div>
              ) : (
                <div key={row.key} className='flex gap-1.5'>
                  {row.label !== '' && (
                    <span className='text-muted-foreground shrink-0'>
                      {t(row.label)}:
                    </span>
                  )}
                  <span
                    className={cn(
                      'font-medium break-all',
                      row.mono && 'font-mono'
                    )}
                  >
                    {row.value}
                  </span>
                </div>
              )
            )}
          </div>
        </div>
      ))}
    </Dialog>
  )
}
