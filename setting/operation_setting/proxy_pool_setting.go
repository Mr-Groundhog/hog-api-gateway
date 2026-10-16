package operation_setting

import (
	"fmt"
	"strconv"

	"github.com/QuantumNous/new-api/setting/config"
)

// ProxyPoolSetting 代理池的自动检测配置。检测由系统任务框架按 AutoCheckMinutes
// 周期执行，只检测启用中的条目，结果写回条目并刷新池快照。
type ProxyPoolSetting struct {
	// AutoCheckEnabled 是否启用代理池定时检测。
	AutoCheckEnabled bool `json:"auto_check_enabled"`
	// AutoCheckMinutes 定时检测的间隔（分钟）。
	AutoCheckMinutes int `json:"auto_check_minutes"`
}

const (
	ProxyPoolAutoCheckEnabledOptionKey = "proxy_pool_setting.auto_check_enabled"
	ProxyPoolAutoCheckMinutesOptionKey = "proxy_pool_setting.auto_check_minutes"

	DefaultProxyPoolAutoCheckMinutes = 30
	MinProxyPoolAutoCheckMinutes     = 1
	MaxProxyPoolAutoCheckMinutes     = 1440
)

var proxyPoolSetting = ProxyPoolSetting{
	AutoCheckEnabled: false,
	AutoCheckMinutes: DefaultProxyPoolAutoCheckMinutes,
}

func init() {
	config.GlobalConfig.Register("proxy_pool_setting", &proxyPoolSetting)
}

// GetProxyPoolSetting 返回代理池配置，越界的间隔按边界归一化。
func GetProxyPoolSetting() *ProxyPoolSetting {
	proxyPoolSetting.AutoCheckMinutes = NormalizeProxyPoolAutoCheckMinutes(proxyPoolSetting.AutoCheckMinutes)
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

func ValidateProxyPoolAutoCheckMinutes(value string) error {
	minutes, err := strconv.Atoi(value)
	if err != nil || minutes < MinProxyPoolAutoCheckMinutes || minutes > MaxProxyPoolAutoCheckMinutes {
		return fmt.Errorf("proxy pool check interval must be between %d and %d minutes", MinProxyPoolAutoCheckMinutes, MaxProxyPoolAutoCheckMinutes)
	}
	return nil
}
