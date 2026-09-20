package log_setting

import "github.com/QuantumNous/new-api/setting/config"

// LogSetting 用量日志的展示配置
type LogSetting struct {
	// ResponseModelUserVisible 是否向普通用户展示上游返回的模型（response_model）。
	// 关闭后该字段仅管理员可见，普通用户仍可查看自己的日志与请求模型。
	ResponseModelUserVisible bool `json:"response_model_user_visible"`
}

// 默认配置：默认向普通用户展示上游返回的模型
var logSetting = LogSetting{
	ResponseModelUserVisible: true,
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("log_setting", &logSetting)
}

// IsResponseModelUserVisible 返回上游返回的模型是否对普通用户可见
func IsResponseModelUserVisible() bool {
	return logSetting.ResponseModelUserVisible
}
