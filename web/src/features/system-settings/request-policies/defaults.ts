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
import type { ChannelAffinitySettings } from '../general/channel-affinity/types'
import type { SecuritySettings } from '../types'

export type RetrySettings = {
  RetryTimes: number
  AutomaticRetryStatusCodes: string
}
export type HealthSettings = {
  ChannelDisableThreshold: string
  AutomaticDisableChannelEnabled: boolean
  AutomaticEnableChannelEnabled: boolean
  AutomaticDisableKeywords: string
  AutomaticDisableStatusCodes: string
  'monitor_setting.auto_test_channel_enabled': boolean
  'monitor_setting.auto_test_channel_minutes': number
  'monitor_setting.channel_test_concurrency': number
  'monitor_setting.channel_test_mode':
    | 'scheduled_all'
    | 'auto_ban_only'
    | 'passive_recovery'
}
export type FilteringSettings = Pick<
  SecuritySettings,
  | 'CheckSensitiveEnabled'
  | 'CheckSensitiveOnPromptEnabled'
  | 'SensitiveWords'
  | 'SensitiveWordExcludedGroups'
  | 'SensitiveWordAutoBanEnabled'
  | 'SensitiveWordAutoBanThreshold'
>
export type ProxyPoolSettings = {
  'proxy_pool_setting.auto_check_enabled': boolean
  'proxy_pool_setting.auto_check_minutes': number
  'proxy_pool_setting.check_timeout_seconds': number
  'proxy_pool_setting.check_url': string
}
export type RequestPolicySettings = RetrySettings &
  HealthSettings &
  FilteringSettings &
  ProxyPoolSettings &
  AIReviewSettings &
  Pick<ChannelAffinitySettings, keyof ChannelAffinitySettings>
export type AIReviewSettings = {
  'ai_review_setting.enabled': boolean
  'ai_review_setting.base_url': string
  'ai_review_setting.model_name': string
  'ai_review_setting.timeout_seconds': number
  'ai_review_setting.sample_rate': number
  'ai_review_setting.excluded_groups': string[]
  'ai_review_setting.max_excerpt_chars': number
  'ai_review_setting.review_sensitive_hits': boolean
  'ai_review_setting.min_confidence': number
  'ai_review_setting.policy_text': string
  'ai_review_setting.auto_ban_enabled': boolean
  'ai_review_setting.auto_ban_threshold': number
  'ai_review_setting.auto_ban_window_days': number
  'ai_review_setting.notify_admin_enabled': boolean
  'ai_review_setting.api_key_configured': boolean
}

export const defaultRequestPolicySettings: RequestPolicySettings = {
  RetryTimes: 0,
  AutomaticRetryStatusCodes:
    '100-199,300-399,401-407,409-499,500-503,505-523,525-599',
  ChannelDisableThreshold: '',
  AutomaticDisableChannelEnabled: false,
  AutomaticEnableChannelEnabled: false,
  AutomaticDisableKeywords: '',
  AutomaticDisableStatusCodes: '401',
  'monitor_setting.auto_test_channel_enabled': false,
  'monitor_setting.auto_test_channel_minutes': 10,
  'monitor_setting.channel_test_concurrency': 1,
  'monitor_setting.channel_test_mode': 'scheduled_all',
  'proxy_pool_setting.auto_check_enabled': false,
  'proxy_pool_setting.auto_check_minutes': 30,
  'proxy_pool_setting.check_timeout_seconds': 6,
  'proxy_pool_setting.check_url': '',
  'channel_affinity_setting.enabled': false,
  'channel_affinity_setting.session_mode': '',
  'channel_affinity_setting.switch_on_success': true,
  'channel_affinity_setting.keep_on_channel_disabled': false,
  'channel_affinity_setting.max_entries': 100000,
  'channel_affinity_setting.default_ttl_seconds': 3600,
  'channel_affinity_setting.rules': '[]',
  CheckSensitiveEnabled: false,
  CheckSensitiveOnPromptEnabled: false,
  SensitiveWords: '',
  SensitiveWordExcludedGroups: [],
  SensitiveWordAutoBanEnabled: false,
  SensitiveWordAutoBanThreshold: 20,
  'ai_review_setting.enabled': false,
  'ai_review_setting.base_url': '',
  'ai_review_setting.model_name': '',
  'ai_review_setting.timeout_seconds': 45,
  'ai_review_setting.sample_rate': 0.05,
  'ai_review_setting.excluded_groups': [],
  'ai_review_setting.max_excerpt_chars': 6000,
  'ai_review_setting.review_sensitive_hits': true,
  'ai_review_setting.min_confidence': 0.6,
  'ai_review_setting.policy_text': '',
  'ai_review_setting.auto_ban_enabled': false,
  'ai_review_setting.auto_ban_threshold': 3,
  'ai_review_setting.auto_ban_window_days': 7,
  'ai_review_setting.notify_admin_enabled': false,
  'ai_review_setting.api_key_configured': false,
}
