import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { updateSystemOption } from '../api'

export type PolicyConfig = {
  options: Record<string, string>
}
export type PolicyDecision = { action: string; reason: string; source: string }
export type PolicyEvent = {
  attempt: number
  channel_id?: number
  group?: string
  rule?: string
  status?: number
  error_code?: string
  error_source?: string
  elapsed_ms: number
  decision: PolicyDecision
  health?: string
}
type Response<T> = { success: boolean; message?: string; data: T }
export async function getPolicyConfig() {
  const response = await api.get<Response<PolicyConfig>>(
    '/api/option/request_policy'
  )
  return requireServerSuccess(response.data).data
}
export async function savePolicyConfig(options: Record<string, string>) {
  const response = await api.patch<Response<PolicyConfig>>(
    '/api/option/request_policy',
    { options }
  )
  return requireServerSuccess(response.data).data
}

export type AIReviewConnectionRequest = {
  base_url: string
  /** true 表示 base_url 已是完整请求地址，后端不再拼接 /v1/chat/completions。 */
  full_url_enabled: boolean
  model_name: string
  /** 留空表示使用已保存的密钥，前端从不回显密钥。 */
  api_key: string
  /** 自定义请求参数 JSON 字符串，随测试请求一起发送；留空表示不附加。 */
  custom_request_body: string
}
type AIReviewConnectionData = { reply: string }
export async function testAIReviewConnection(
  request: AIReviewConnectionRequest
) {
  const response = await api.post<Response<AIReviewConnectionData>>(
    '/api/option/ai_review/test',
    request
  )
  return response.data
}

// AI 审核设置是一组相关配置项，逐项写入但只提示一次成功，避免刷屏。
export async function saveAIReviewOptions(options: Record<string, string>) {
  for (const [key, value] of Object.entries(options)) {
    requireServerSuccess(await updateSystemOption({ key, value }))
  }
}
