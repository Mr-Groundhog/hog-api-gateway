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

export function RiskControlCenter() {
  const { t } = useTranslation()
  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Risk Control Center')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <Tabs className='h-full min-h-0' defaultValue='sensitive-word-triggers'>
          <TabsList className='group-data-horizontal/tabs:h-auto max-w-full flex-wrap justify-start'>
            <TabsTrigger value='sensitive-word-triggers'>{t('Sensitive Word Triggers')}</TabsTrigger>
            <TabsTrigger value='liveness-check-list'>{t('Liveness Check List')}</TabsTrigger>
          </TabsList>
          <TabsContent className='min-h-0' value='sensitive-word-triggers'>
            <SensitiveWordTriggersTab />
          </TabsContent>
          <TabsContent className='min-h-0' value='liveness-check-list'>
            <ProbeGuardTab />
          </TabsContent>
        </Tabs>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
