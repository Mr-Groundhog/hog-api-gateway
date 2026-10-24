package risk_setting

import (
	"slices"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/setting/config"
)

// AI 审核摘录字符数的取值范围。运行时读到的值始终在范围内，越界配置在读取时收敛。
const (
	MinAIReviewExcerptChars = 1000
	MaxAIReviewExcerptChars = 20000
)

// AIReviewSetting 定义事后 AI 内容审核的运行时配置。审核不阻断请求：请求路径
// 上仅做抽检决策与有界摘录捕获，判定、落库、通知与自动封禁全部由后台 worker
// 异步完成。
type AIReviewSetting struct {
	// Enabled 控制整个 AI 审核功能是否启用。
	Enabled bool `json:"enabled"`
	// BaseUrl 是 OpenAI 兼容审核接口的地址，例如 https://api.openai.com。
	BaseUrl string `json:"base_url"`
	// ApiKey 是审核接口的密钥。管理端提交留空表示保留已配置值，选项读取时不会回显。
	ApiKey string `json:"api_key"`
	// ModelName 是执行审核判定的模型名。
	ModelName string `json:"model_name"`
	// TimeoutSeconds 是单次审核调用的超时秒数。
	TimeoutSeconds int `json:"timeout_seconds"`
	// SampleRate 是未命中敏感词请求的抽检比例，0~1，0 表示不抽检。
	SampleRate float64 `json:"sample_rate"`
	// ExcludedGroups 是不参与 AI 审核的分组名单，配置系统整体替换该切片。
	ExcludedGroups []string `json:"excluded_groups"`
	// MaxExcerptChars 是每条送审摘录的最大字符数，超大上下文只保留开头部分。
	MaxExcerptChars int `json:"max_excerpt_chars"`
	// ReviewSensitiveHits 控制被敏感词拦截的请求是否也送 AI 复核，用于甄别误伤。
	ReviewSensitiveHits bool `json:"review_sensitive_hits"`
	// MinConfidence 是判定违规成立所需的最低置信度，低于该值不记违规。
	MinConfidence float64 `json:"min_confidence"`
	// PolicyText 是管理员附加的审核政策，拼接进审核系统提示。
	PolicyText string `json:"policy_text"`
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
		SampleRate:          0.05,
		MaxExcerptChars:     6000,
		ReviewSensitiveHits: true,
		MinConfidence:       0.6,
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

// AIReviewCallConfig 返回发起审核调用所需的接口配置，超时收敛到至少 5 秒。
func AIReviewCallConfig() (baseUrl string, apiKey string, model string, timeoutSeconds int) {
	aiReviewMutex.RLock()
	defer aiReviewMutex.RUnlock()
	baseUrl = strings.TrimSuffix(strings.TrimSpace(aiReviewSetting.BaseUrl), "/")
	apiKey = strings.TrimSpace(aiReviewSetting.ApiKey)
	model = strings.TrimSpace(aiReviewSetting.ModelName)
	timeoutSeconds = aiReviewSetting.TimeoutSeconds
	if timeoutSeconds < 5 {
		timeoutSeconds = 5
	}
	return baseUrl, apiKey, model, timeoutSeconds
}

// ShouldAIReviewSensitiveHits 判断敏感词命中请求是否送 AI 复核。
func ShouldAIReviewSensitiveHits() bool {
	aiReviewMutex.RLock()
	defer aiReviewMutex.RUnlock()
	return aiReviewSetting.ReviewSensitiveHits
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
