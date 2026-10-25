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
  /** 回复 token 上限，取表单当前值，使测试与正式审核使用同一预算。 */
  max_output_tokens: number
  /** 使用当前表单的 JSON 输出开关，包括尚未保存的修改。 */
  force_json_response: boolean
}
/** 连接测试的完整观测结果，失败时 error 非空但请求与响应仍可用于排查。 */
export type AIReviewConnectionData = {
  request_url: string
  request_body: string
  status_code: number
  content: string
  raw_response: string
  error: string
}
export async function testAIReviewConnection(
  request: AIReviewConnectionRequest
) {
  const response = await api.post<Response<AIReviewConnectionData>>(
    '/api/option/ai_review/test',
    request
  )
  return requireServerSuccess(response.data)
}

// AI 审核设置是一组相关配置项，逐项写入但只提示一次成功，避免刷屏。
export async function saveAIReviewOptions(options: Record<string, string>) {
  for (const [key, value] of Object.entries(options)) {
    requireServerSuccess(await updateSystemOption({ key, value }))
  }
}
