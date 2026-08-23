package operation_setting

import (
	"fmt"
	"strconv"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/setting/config"
)

// ProbeGuardSettings 短时间跨模型测活检测（probe guard）的运行时配置。
type ProbeGuardSettings struct {
	// Enabled 是否启用测活检测。关闭时（含 DryRun 关闭）中间件直接放行。
	Enabled bool `json:"enabled"`
	// DryRun 观察模式：记录触发日志但不拦截请求、不累计惩罚计数。
	DryRun bool `json:"dry_run"`
	// WindowSeconds 滑动窗口时长（秒）。
	WindowSeconds int `json:"window_seconds"`
	// ModelThreshold 窗口内允许的不同模型数量上限，达到即判定为测活违规。
	ModelThreshold int `json:"model_threshold"`
	// MaxTriggers 允许的违规触发次数，达到后自动封禁；1 为即时封禁，2 为先警告后封禁。
	MaxTriggers int `json:"max_triggers"`
	// ExcludedGroups 豁免测活检测的用户分组列表。
	ExcludedGroups []string `json:"excluded_groups"`
	// WhitelistUserIds 逗号分隔的豁免用户 ID 列表。
	WhitelistUserIds string `json:"whitelist_user_ids"`
}

const (
	ProbeGuardWindowSecondsOptionKey  = "probe_guard.window_seconds"
	ProbeGuardModelThresholdOptionKey = "probe_guard.model_threshold"
	ProbeGuardMaxTriggersOptionKey    = "probe_guard.max_triggers"

	DefaultProbeGuardWindowSeconds  = 30
	MinProbeGuardWindowSeconds      = 1
	MaxProbeGuardWindowSeconds      = 3600
	DefaultProbeGuardModelThreshold = 6
	MinProbeGuardModelThreshold     = 2
	MaxProbeGuardModelThreshold     = 100
	DefaultProbeGuardMaxTriggers    = 2
	MinProbeGuardMaxTriggers        = 1
	MaxProbeGuardMaxTriggers        = 10
)

var probeGuardSetting = ProbeGuardSettings{
	Enabled:         false,
	DryRun:          false,
	WindowSeconds:   DefaultProbeGuardWindowSeconds,
	ModelThreshold:  DefaultProbeGuardModelThreshold,
	MaxTriggers:     DefaultProbeGuardMaxTriggers,
	ExcludedGroups:  []string{},
	WhitelistUserIds: "",
}

func init() {
	config.GlobalConfig.Register("probe_guard", &probeGuardSetting)
}

// GetProbeGuardSettings 返回归一化后的测活检测配置。
func GetProbeGuardSettings() *ProbeGuardSettings {
	probeGuardSetting.WindowSeconds = NormalizeProbeGuardWindowSeconds(probeGuardSetting.WindowSeconds)
	probeGuardSetting.ModelThreshold = NormalizeProbeGuardModelThreshold(probeGuardSetting.ModelThreshold)
	probeGuardSetting.MaxTriggers = NormalizeProbeGuardMaxTriggers(probeGuardSetting.MaxTriggers)
	return &probeGuardSetting
}

func NormalizeProbeGuardWindowSeconds(value int) int {
	if value < MinProbeGuardWindowSeconds {
		return DefaultProbeGuardWindowSeconds
	}
	if value > MaxProbeGuardWindowSeconds {
		return MaxProbeGuardWindowSeconds
	}
	return value
}

func NormalizeProbeGuardModelThreshold(value int) int {
	if value < MinProbeGuardModelThreshold {
		return DefaultProbeGuardModelThreshold
	}
	if value > MaxProbeGuardModelThreshold {
		return MaxProbeGuardModelThreshold
	}
	return value
}

func NormalizeProbeGuardMaxTriggers(value int) int {
	if value < MinProbeGuardMaxTriggers {
		return DefaultProbeGuardMaxTriggers
	}
	if value > MaxProbeGuardMaxTriggers {
		return MaxProbeGuardMaxTriggers
	}
	return value
}

func ValidateProbeGuardIntOption(key string, value string) error {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return fmt.Errorf("%s must be an integer", key)
	}
	switch key {
	case ProbeGuardWindowSecondsOptionKey:
		if parsed < MinProbeGuardWindowSeconds || parsed > MaxProbeGuardWindowSeconds {
			return fmt.Errorf("probe guard window seconds must be between %d and %d", MinProbeGuardWindowSeconds, MaxProbeGuardWindowSeconds)
		}
	case ProbeGuardModelThresholdOptionKey:
		if parsed < MinProbeGuardModelThreshold || parsed > MaxProbeGuardModelThreshold {
			return fmt.Errorf("probe guard model threshold must be between %d and %d", MinProbeGuardModelThreshold, MaxProbeGuardModelThreshold)
		}
	case ProbeGuardMaxTriggersOptionKey:
		if parsed < MinProbeGuardMaxTriggers || parsed > MaxProbeGuardMaxTriggers {
			return fmt.Errorf("probe guard max triggers must be between %d and %d", MinProbeGuardMaxTriggers, MaxProbeGuardMaxTriggers)
		}
	}
	return nil
}

var probeGuardDerivedMutex sync.RWMutex
var probeGuardExcludedGroups = map[string]struct{}{}
var probeGuardWhitelistUserIds = map[int]struct{}{}
var probeGuardDerivedSource = ""

// refreshProbeGuardDerivedExemptions rebuilds the exempt lookups when the
// configured sources change, so the hot path never parses strings per request.
func refreshProbeGuardDerivedExemptions(settings *ProbeGuardSettings) {
	source := strings.Join(settings.ExcludedGroups, ",") + "|" + settings.WhitelistUserIds
	probeGuardDerivedMutex.RLock()
	unchanged := source == probeGuardDerivedSource
	probeGuardDerivedMutex.RUnlock()
	if unchanged {
		return
	}

	groups := make(map[string]struct{}, len(settings.ExcludedGroups))
	for _, group := range settings.ExcludedGroups {
		if trimmed := strings.TrimSpace(group); trimmed != "" {
			groups[trimmed] = struct{}{}
		}
	}
	ids := map[int]struct{}{}
	for _, part := range strings.Split(settings.WhitelistUserIds, ",") {
		if id, err := strconv.Atoi(strings.TrimSpace(part)); err == nil && id > 0 {
			ids[id] = struct{}{}
		}
	}

	probeGuardDerivedMutex.Lock()
	probeGuardExcludedGroups = groups
	probeGuardWhitelistUserIds = ids
	probeGuardDerivedSource = source
	probeGuardDerivedMutex.Unlock()
}

// IsProbeGuardExempt 判断用户是否命中分组或白名单豁免。
func IsProbeGuardExempt(settings *ProbeGuardSettings, userId int, group string) bool {
	refreshProbeGuardDerivedExemptions(settings)
	probeGuardDerivedMutex.RLock()
	defer probeGuardDerivedMutex.RUnlock()
	if group != "" {
		if _, ok := probeGuardExcludedGroups[group]; ok {
			return true
		}
	}
	_, ok := probeGuardWhitelistUserIds[userId]
	return ok
}
