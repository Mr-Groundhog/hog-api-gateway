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
import { createSectionRegistry } from '../utils/section-registry'
import { AIReviewSection } from './ai-review-section'
import { ChannelHealthSection } from './channel-health-section'
import type { RequestPolicySettings } from './defaults'
import { ProxyPoolSection } from './proxy-pool-section'
import { RequestChecksSection } from './request-checks-section'
import { RoutingPolicySection } from './routing-section'

const POLICY_SECTIONS = [
  {
    id: 'filtering',
    titleKey: 'Request checks',
    build: (settings: RequestPolicySettings) => (
      <RequestChecksSection
        defaultValues={{
          CheckSensitiveEnabled: settings.CheckSensitiveEnabled,
          CheckSensitiveOnPromptEnabled: settings.CheckSensitiveOnPromptEnabled,
          SensitiveWords: settings.SensitiveWords,
          SensitiveWordExcludedGroups: settings.SensitiveWordExcludedGroups,
          SensitiveWordAutoBanEnabled: settings.SensitiveWordAutoBanEnabled,
          SensitiveWordAutoBanThreshold:
            settings.SensitiveWordAutoBanThreshold,
        }}
      />
    ),
  },
  {
    id: 'ai-review',
    titleKey: 'AI content review',
    build: (settings: RequestPolicySettings) => (
      <AIReviewSection
        defaultValues={{
          'ai_review_setting.enabled': settings['ai_review_setting.enabled'],
          'ai_review_setting.base_url': settings['ai_review_setting.base_url'],
          'ai_review_setting.model_name':
            settings['ai_review_setting.model_name'],
          'ai_review_setting.timeout_seconds':
            settings['ai_review_setting.timeout_seconds'],
          'ai_review_setting.sample_rate':
            settings['ai_review_setting.sample_rate'],
          'ai_review_setting.excluded_groups':
            settings['ai_review_setting.excluded_groups'],
          'ai_review_setting.max_excerpt_chars':
            settings['ai_review_setting.max_excerpt_chars'],
          'ai_review_setting.review_sensitive_hits':
            settings['ai_review_setting.review_sensitive_hits'],
          'ai_review_setting.min_confidence':
            settings['ai_review_setting.min_confidence'],
          'ai_review_setting.policy_text':
            settings['ai_review_setting.policy_text'],
          'ai_review_setting.auto_ban_enabled':
            settings['ai_review_setting.auto_ban_enabled'],
          'ai_review_setting.auto_ban_threshold':
            settings['ai_review_setting.auto_ban_threshold'],
          'ai_review_setting.auto_ban_window_days':
            settings['ai_review_setting.auto_ban_window_days'],
          'ai_review_setting.notify_admin_enabled':
            settings['ai_review_setting.notify_admin_enabled'],
          'ai_review_setting.api_key_configured':
            settings['ai_review_setting.api_key_configured'],
        }}
      />
    ),
  },
  {
    id: 'routing',
    titleKey: 'Sessions and retries',
    build: () => <RoutingPolicySection />,
  },
  {
    id: 'health',
    titleKey: 'Channel health',
    build: (settings: RequestPolicySettings) => (
      <ChannelHealthSection defaultValues={settings} />
    ),
  },
  {
    id: 'proxy-pool',
    titleKey: 'Proxy Pool',
    build: (settings: RequestPolicySettings) => (
      <ProxyPoolSection
        defaultValues={{
          'proxy_pool_setting.auto_check_enabled':
            settings['proxy_pool_setting.auto_check_enabled'],
          'proxy_pool_setting.auto_check_minutes':
            settings['proxy_pool_setting.auto_check_minutes'],
          'proxy_pool_setting.check_timeout_seconds':
            settings['proxy_pool_setting.check_timeout_seconds'],
          'proxy_pool_setting.check_url':
            settings['proxy_pool_setting.check_url'],
        }}
      />
    ),
  },
] as const

export type PolicySectionId = (typeof POLICY_SECTIONS)[number]['id']
const registry = createSectionRegistry<PolicySectionId, RequestPolicySettings>({
  sections: POLICY_SECTIONS,
  defaultSection: 'routing',
  basePath: '/system-settings/request-policies',
  urlStyle: 'path',
})
export const POLICY_SECTION_IDS = registry.sectionIds
export const getPolicySectionNavItems = registry.getSectionNavItems
export const getPolicySectionContent = registry.getSectionContent
export const getPolicySectionMeta = registry.getSectionMeta
