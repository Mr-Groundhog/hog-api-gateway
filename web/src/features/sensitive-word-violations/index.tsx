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

import { SectionPageLayout } from '@/components/layout'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { ProbeGuardTab } from './components/probe-guard-tab'
import { SensitiveWordTriggersTab } from './components/sensitive-word-triggers-tab'
import { TokenRiskTab } from './components/token-risk-tab'
import { AIReviewTab } from './components/ai-review-tab'

export function RiskControlCenter() {
  const { t } = useTranslation()
  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        {t('Risk Control Center')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <Tabs className='h-full min-h-0' defaultValue='ai-review'>
          <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
            <TabsTrigger value='ai-review'>
              {t('AI Review')}
            </TabsTrigger>
            <TabsTrigger value='sensitive-word-triggers'>
              {t('Sensitive Word Triggers')}
            </TabsTrigger>
            <TabsTrigger value='liveness-check-list'>
              {t('Liveness Check List')}
            </TabsTrigger>
            <TabsTrigger value='token-distribution'>
              {t('Suspected Distribution Users')}
            </TabsTrigger>
          </TabsList>
          <TabsContent className='min-h-0' value='ai-review'>
            <AIReviewTab />
          </TabsContent>
          <TabsContent className='min-h-0' value='sensitive-word-triggers'>
            <SensitiveWordTriggersTab />
          </TabsContent>
          <TabsContent className='min-h-0' value='liveness-check-list'>
            <ProbeGuardTab />
          </TabsContent>
          <TabsContent className='min-h-0' value='token-distribution'>
            <TokenRiskTab />
          </TabsContent>
        </Tabs>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
