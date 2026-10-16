package operation_setting

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

// ProxyPoolSetting 代理池的自动检测配置。检测由系统任务框架按 AutoCheckMinutes
// 周期执行，只检测启用中的条目，结果写回条目并刷新池快照。
type ProxyPoolSetting struct {
	// AutoCheckEnabled 是否启用代理池定时检测。
	AutoCheckEnabled bool `json:"auto_check_enabled"`
	// AutoCheckMinutes 定时检测的间隔（分钟）。
	AutoCheckMinutes int `json:"auto_check_minutes"`
	// CheckUrl 检测地址：检测请求经代理访问该地址，并从中解析出口 IP。为空表示
	// 本地检测模式（默认）：只验证代理端点可达且凭据有效，不访问外部地址，也不
	// 解析出口 IP。需要出口 IP 时填写能回显调用方 IP 的地址。
	CheckUrl string `json:"check_url"`
	// CheckTimeoutSeconds 单条代理检测的超时（秒）。
	CheckTimeoutSeconds int `json:"check_timeout_seconds"`
}

const (
	ProxyPoolAutoCheckEnabledOptionKey = "proxy_pool_setting.auto_check_enabled"
	ProxyPoolAutoCheckMinutesOptionKey = "proxy_pool_setting.auto_check_minutes"
	ProxyPoolCheckUrlOptionKey         = "proxy_pool_setting.check_url"
	ProxyPoolCheckTimeoutOptionKey     = "proxy_pool_setting.check_timeout_seconds"

	DefaultProxyPoolAutoCheckMinutes = 30
	MinProxyPoolAutoCheckMinutes     = 1
	MaxProxyPoolAutoCheckMinutes     = 1440

	// RecommendedProxyPoolCheckUrl 是配置检测地址时的推荐值：它回显调用方出口
	// IP，用于在管理端与日志中展示每条代理的出口。默认不配置，保持本地检测。
	RecommendedProxyPoolCheckUrl    = "https://api.ipify.org?format=json"
	DefaultProxyPoolCheckTimeoutSec = 6
	MinProxyPoolCheckTimeoutSec     = 1
	MaxProxyPoolCheckTimeoutSec     = 60
)

var proxyPoolSetting = ProxyPoolSetting{
	AutoCheckEnabled:    false,
	AutoCheckMinutes:    DefaultProxyPoolAutoCheckMinutes,
	CheckUrl:            "",
	CheckTimeoutSeconds: DefaultProxyPoolCheckTimeoutSec,
}

func init() {
	config.GlobalConfig.Register("proxy_pool_setting", &proxyPoolSetting)
}

// GetProxyPoolSetting 返回代理池配置，越界的间隔与超时按边界归一化。
func GetProxyPoolSetting() *ProxyPoolSetting {
	proxyPoolSetting.AutoCheckMinutes = NormalizeProxyPoolAutoCheckMinutes(proxyPoolSetting.AutoCheckMinutes)
	proxyPoolSetting.CheckTimeoutSeconds = NormalizeProxyPoolCheckTimeoutSeconds(proxyPoolSetting.CheckTimeoutSeconds)
	proxyPoolSetting.CheckUrl = strings.TrimSpace(proxyPoolSetting.CheckUrl)
	return &proxyPoolSetting
}

func NormalizeProxyPoolAutoCheckMinutes(minutes int) int {
	if minutes < MinProxyPoolAutoCheckMinutes {
		return DefaultProxyPoolAutoCheckMinutes
	}
	if minutes > MaxProxyPoolAutoCheckMinutes {
		return MaxProxyPoolAutoCheckMinutes
	}
	return minutes
}

func NormalizeProxyPoolCheckTimeoutSeconds(seconds int) int {
	if seconds < MinProxyPoolCheckTimeoutSec {
		return DefaultProxyPoolCheckTimeoutSec
	}
	if seconds > MaxProxyPoolCheckTimeoutSec {
		return MaxProxyPoolCheckTimeoutSec
	}
	return seconds
}

func ValidateProxyPoolAutoCheckMinutes(value string) error {
	minutes, err := strconv.Atoi(value)
	if err != nil || minutes < MinProxyPoolAutoCheckMinutes || minutes > MaxProxyPoolAutoCheckMinutes {
		return fmt.Errorf("proxy pool check interval must be between %d and %d minutes", MinProxyPoolAutoCheckMinutes, MaxProxyPoolAutoCheckMinutes)
	}
	return nil
}

func ValidateProxyPoolCheckTimeout(value string) error {
	seconds, err := strconv.Atoi(value)
	if err != nil || seconds < MinProxyPoolCheckTimeoutSec || seconds > MaxProxyPoolCheckTimeoutSec {
		return fmt.Errorf("proxy pool check timeout must be between %d and %d seconds", MinProxyPoolCheckTimeoutSec, MaxProxyPoolCheckTimeoutSec)
	}
	return nil
}

// ValidateProxyPoolCheckUrl 校验检测地址。空值合法，表示本地检测模式。
func ValidateProxyPoolCheckUrl(value string) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return fmt.Errorf("proxy pool check url is invalid: %s", err.Error())
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("proxy pool check url must use http or https")
	}
	if parsed.Host == "" {
		return fmt.Errorf("proxy pool check url must include a host")
	}
	return nil
}
