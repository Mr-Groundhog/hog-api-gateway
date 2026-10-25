package risk_setting

import (
	"slices"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

// AI 审核摘录字符数的取值范围。运行时读到的值始终在范围内，越界配置在读取时收敛。
const (
	MinAIReviewExcerptChars = 1000
	MaxAIReviewExcerptChars = 20000

	// MinAIReviewMaxOutputTokens / MaxAIReviewMaxOutputTokens 是单次审核回复的
	// token 上限范围；默认值需要容纳推理模型先输出思维链再输出 JSON。
	MinAIReviewMaxOutputTokens     = 128
	MaxAIReviewMaxOutputTokens     = 32768
	DefaultAIReviewMaxOutputTokens = 2048
)

// AIReviewSetting 定义事后 AI 内容审核的运行时配置。审核不阻断请求：请求路径
// 上仅做抽检决策与有界摘录捕获，判定、落库、通知与自动封禁全部由后台 worker
// 异步完成。
type AIReviewSetting struct {
	// Enabled 控制整个 AI 审核功能是否启用。
	Enabled bool `json:"enabled"`
	// BaseUrl 是 OpenAI 兼容审核接口的地址，例如 https://api.openai.com。
	BaseUrl string `json:"base_url"`
	// FullUrlEnabled 表示 BaseUrl 已是完整请求地址，不再自动拼接
	// /v1/chat/completions。部分服务商的审核接口使用 /v2/chat/completions
	// 等非标准路径，需要原样请求。
	FullUrlEnabled bool `json:"full_url_enabled"`
	// ApiKey 是审核接口的密钥。管理端提交留空表示保留已配置值，选项读取时不会回显。
	ApiKey string `json:"api_key"`
	// ModelName 是执行审核判定的模型名。
	ModelName string `json:"model_name"`
	// TimeoutSeconds 是单次审核调用的超时秒数。
	TimeoutSeconds int `json:"timeout_seconds"`
	// MaxOutputTokens 是单次审核调用的回复 token 上限。推理模型会先消耗一部分
	// 预算输出思维链，再输出 JSON，因此该值过小会导致 content 为空或 JSON 被
	// 截断；默认值按兼容推理模型设定。
	MaxOutputTokens int `json:"max_output_tokens"`
	// SampleRate 是未命中敏感词请求的抽检比例，0~1，0 表示不抽检。
	SampleRate float64 `json:"sample_rate"`
	// ExcludedGroups 是不参与 AI 审核的分组名单，配置系统整体替换该切片。
	ExcludedGroups []string `json:"excluded_groups"`
	// MaxExcerptChars 是每条送审摘录的最大字符数，超大上下文只保留开头部分。
	MaxExcerptChars int `json:"max_excerpt_chars"`
	// ReviewSensitiveHits 控制被敏感词拦截的请求是否也送 AI 复核，用于甄别误伤。
	ReviewSensitiveHits bool `json:"review_sensitive_hits"`
	// RecordCleanSamples 控制抽检来源的通过结果是否也落库留痕。关闭时抽检判定
	// 干净与调用失败的记录即弃，仅违规记录可查；开启后每个被抽中的请求都能在
	// 审核列表追溯，代价是高抽检比例下逐请求写库。
	RecordCleanSamples bool `json:"record_clean_samples"`
	// MinConfidence 是判定违规成立所需的最低置信度，低于该值不记违规。
	MinConfidence float64 `json:"min_confidence"`
	// PolicyText 是管理员附加的审核政策，拼接进审核系统提示。
	PolicyText string `json:"policy_text"`
	// ForceJSONResponse 控制是否在审核请求中发送 response_format json_object，
	// 由接口强制模型输出 JSON。接口不支持该参数时会自动降级为不带参数重试一次。
	ForceJSONResponse bool `json:"force_json_response"`
	// CustomRequestBody 是管理员自定义的 JSON 对象，会深度合并进每次审核请求体，用于
	// 服务商特有的参数（例如讯飞用 text.format 指定 JSON 输出）。messages 由审核
	// 流程生成，不允许被覆盖。
	CustomRequestBody string `json:"custom_request_body"`
	// AutoBanEnabled 控制窗口期内累计违规达到阈值后是否自动封禁。
	AutoBanEnabled bool `json:"auto_ban_enabled"`
	// AutoBanThreshold 是触发自动封禁的窗口期内违规次数阈值。
	AutoBanThreshold int `json:"auto_ban_threshold"`
	// AutoBanWindowDays 是自动封禁计数的滚动窗口天数。
	AutoBanWindowDays int `json:"auto_ban_window_days"`
	// NotifyAdminEnabled 控制判定违规后是否通知订阅了 AI 审核通知的管理员。
	// 默认关闭以避免打扰管理员，需要时显式开启。
	NotifyAdminEnabled bool `json:"notify_admin_enabled"`
}

var (
	aiReviewSetting = AIReviewSetting{
		Enabled:             false,
		TimeoutSeconds:      45,
		MaxOutputTokens:     DefaultAIReviewMaxOutputTokens,
		SampleRate:          0.05,
		MaxExcerptChars:     6000,
		ReviewSensitiveHits: true,
		RecordCleanSamples:  false,
		MinConfidence:       0.6,
		ForceJSONResponse:   true,
		AutoBanThreshold:    3,
		AutoBanWindowDays:   7,
		NotifyAdminEnabled:  false,
	}
	aiReviewMutex sync.RWMutex
)

func init() {
	config.GlobalConfig.Register("ai_review_setting", &aiReviewSetting)
}

// ApplyAIReviewConfigUpdate 在写锁保护下应用一条配置更新，供选项系统调用。
// 配置系统默认的反射写入不持锁，而请求路径的读取持读锁；AI 审核配置在运行期
// 可被修改，因此该组的写入必须经由这里串行化，避免数据竞争。
func ApplyAIReviewConfigUpdate(key, value string) {
	aiReviewMutex.Lock()
	defer aiReviewMutex.Unlock()
	config.UpdateConfigFromMap(&aiReviewSetting, map[string]string{key: value})
}

// GetAIReviewSetting 返回当前 AI 审核配置的快照（含密钥，仅限服务端使用）。
func GetAIReviewSetting() AIReviewSetting {
	aiReviewMutex.RLock()
	defer aiReviewMutex.RUnlock()
	return aiReviewSetting
}

// IsAIReviewConfigured 判断审核接口配置是否完整；不完整时功能视为关闭，避免
// worker 持续对无效地址发起调用。
func IsAIReviewConfigured() bool {
	aiReviewMutex.RLock()
	defer aiReviewMutex.RUnlock()
	return strings.TrimSpace(aiReviewSetting.BaseUrl) != "" &&
		strings.TrimSpace(aiReviewSetting.ApiKey) != "" &&
		strings.TrimSpace(aiReviewSetting.ModelName) != ""
}

// IsAIReviewAPIKeyConfigured 仅判断密钥是否已配置，供管理端显示"已配置"状态。
func IsAIReviewAPIKeyConfigured() bool {
	aiReviewMutex.RLock()
	defer aiReviewMutex.RUnlock()
	return strings.TrimSpace(aiReviewSetting.ApiKey) != ""
}

// ShouldAIReviewForGroup 判断该分组的请求是否参与 AI 审核（总开关、配置完整性
// 与排除名单共同决定）。
func ShouldAIReviewForGroup(group string) bool {
	if group == "" {
		return false
	}
	aiReviewMutex.RLock()
	defer aiReviewMutex.RUnlock()
	if !aiReviewSetting.Enabled {
		return false
	}
	if strings.TrimSpace(aiReviewSetting.BaseUrl) == "" ||
		strings.TrimSpace(aiReviewSetting.ApiKey) == "" ||
		strings.TrimSpace(aiReviewSetting.ModelName) == "" {
		return false
	}
	return !slices.Contains(aiReviewSetting.ExcludedGroups, group)
}

// AIReviewSampleRate 返回收敛到 [0,1] 的抽检比例。
func AIReviewSampleRate() float64 {
	aiReviewMutex.RLock()
	defer aiReviewMutex.RUnlock()
	rate := aiReviewSetting.SampleRate
	if rate < 0 {
		return 0
	}
	if rate > 1 {
		return 1
	}
	return rate
}

// AIReviewMaxExcerptChars 返回收敛到取值范围内的摘录字符上限。
func AIReviewMaxExcerptChars() int {
	aiReviewMutex.RLock()
	defer aiReviewMutex.RUnlock()
	limit := aiReviewSetting.MaxExcerptChars
	if limit < MinAIReviewExcerptChars {
		return MinAIReviewExcerptChars
	}
	if limit > MaxAIReviewExcerptChars {
		return MaxAIReviewExcerptChars
	}
	return limit
}

// AIReviewCallConfig 返回发起审核调用所需的接口配置。超时收敛到至少 5 秒；
// fullURL 为 true 表示 baseUrl 已是完整请求地址，调用方不得再拼接路径。
func AIReviewCallConfig() (baseUrl string, apiKey string, model string, timeoutSeconds int, fullURL bool) {
	aiReviewMutex.RLock()
	defer aiReviewMutex.RUnlock()
	baseUrl = strings.TrimSpace(aiReviewSetting.BaseUrl)
	if !aiReviewSetting.FullUrlEnabled {
		baseUrl = strings.TrimSuffix(baseUrl, "/")
	}
	apiKey = strings.TrimSpace(aiReviewSetting.ApiKey)
	model = strings.TrimSpace(aiReviewSetting.ModelName)
	timeoutSeconds = aiReviewSetting.TimeoutSeconds
	if timeoutSeconds < 5 {
		timeoutSeconds = 5
	}
	return baseUrl, apiKey, model, timeoutSeconds, aiReviewSetting.FullUrlEnabled
}

// AIReviewMaxOutputTokens 返回收敛到取值范围内的回复 token 上限。
func AIReviewMaxOutputTokens() int {
	aiReviewMutex.RLock()
	defer aiReviewMutex.RUnlock()
	limit := aiReviewSetting.MaxOutputTokens
	if limit < MinAIReviewMaxOutputTokens {
		return DefaultAIReviewMaxOutputTokens
	}
	if limit > MaxAIReviewMaxOutputTokens {
		return MaxAIReviewMaxOutputTokens
	}
	return limit
}

// ShouldAIReviewSensitiveHits 判断敏感词命中请求是否送 AI 复核。
func ShouldAIReviewSensitiveHits() bool {
	aiReviewMutex.RLock()
	defer aiReviewMutex.RUnlock()
	return aiReviewSetting.ReviewSensitiveHits
}

// ShouldRecordCleanSamples 判断抽检来源的通过结果是否落库留痕。
func ShouldRecordCleanSamples() bool {
	aiReviewMutex.RLock()
	defer aiReviewMutex.RUnlock()
	return aiReviewSetting.RecordCleanSamples
}

// AIReviewMinConfidence 返回收敛到 [0,1] 的违规置信度阈值。
func AIReviewMinConfidence() float64 {
	aiReviewMutex.RLock()
	defer aiReviewMutex.RUnlock()
	confidence := aiReviewSetting.MinConfidence
	if confidence < 0 {
		return 0
	}
	if confidence > 1 {
		return 1
	}
	return confidence
}

// AIReviewPolicyText 返回管理员附加的审核政策文本。
func AIReviewPolicyText() string {
	aiReviewMutex.RLock()
	defer aiReviewMutex.RUnlock()
	return aiReviewSetting.PolicyText
}

// AIReviewForceJSONResponse 判断审核请求是否附带 response_format json_object。
func AIReviewForceJSONResponse() bool {
	aiReviewMutex.RLock()
	defer aiReviewMutex.RUnlock()
	return aiReviewSetting.ForceJSONResponse
}

// ParseAIReviewCustomRequestBody 解析管理员自定义的请求参数。空字符串表示未配置；
// 非空时必须是 JSON 对象，数组或标量视为配置错误。
func ParseAIReviewCustomRequestBody(raw string) (map[string]any, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}
	var parsed map[string]any
	if err := common.UnmarshalJsonStr(trimmed, &parsed); err != nil || parsed == nil {
		return nil, common.NewMessage("AI review custom request body must be a JSON object")
	}
	return parsed, nil
}

// ValidateAIReviewCustomRequestBody 在保存选项前校验自定义请求参数的格式；messages、
// model、stream 由审核流程自己生成，不允许被自定义参数覆盖。
func ValidateAIReviewCustomRequestBody(raw string) error {
	parsed, err := ParseAIReviewCustomRequestBody(raw)
	if err != nil {
		return err
	}
	for _, reserved := range []string{"messages", "model", "stream"} {
		if _, exists := parsed[reserved]; exists {
			return common.NewMessage("AI review custom request body must not set {{field}}", map[string]any{"field": reserved})
		}
	}
	return nil
}

// AIReviewCustomRequestBody 返回当前生效的自定义请求参数；未配置或解析失败时
// 返回 nil。保存路径已做格式校验，这里的失败分支只防御手工改库等异常数据。
func AIReviewCustomRequestBody() map[string]any {
	aiReviewMutex.RLock()
	raw := aiReviewSetting.CustomRequestBody
	aiReviewMutex.RUnlock()
	parsed, err := ParseAIReviewCustomRequestBody(raw)
	if err != nil {
		return nil
	}
	return parsed
}

// AIReviewAutoBanConfig 返回自动封禁配置，阈值与窗口收敛到至少 1。
func AIReviewAutoBanConfig() (enabled bool, threshold int, windowDays int) {
	aiReviewMutex.RLock()
	defer aiReviewMutex.RUnlock()
	enabled = aiReviewSetting.AutoBanEnabled
	threshold = max(aiReviewSetting.AutoBanThreshold, 1)
	windowDays = max(aiReviewSetting.AutoBanWindowDays, 1)
	return enabled, threshold, windowDays
}

// ShouldNotifyAIReviewAdmins 判断判定违规后是否通知管理员。
func ShouldNotifyAIReviewAdmins() bool {
	aiReviewMutex.RLock()
	defer aiReviewMutex.RUnlock()
	return aiReviewSetting.NotifyAdminEnabled
}
