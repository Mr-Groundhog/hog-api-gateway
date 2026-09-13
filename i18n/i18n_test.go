package i18n

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Init 失败（例如 locale 文件存在 yaml 重复键）只会让所有翻译静默回退为
// 原始键名，启动日志之外没有其他症状，这里直接守护加载成功。
func TestInitLoadsAllLocales(t *testing.T) {
	require.NoError(t, Init())
}

func TestTranslateCooperationMessages(t *testing.T) {
	require.NoError(t, Init())
	assert.Equal(t,
		"今日提交的合作申请数已达上限，请明天再试",
		Translate(LangZhCN, "cooperation.daily_limit"))
	assert.Equal(t,
		"You have reached the daily limit for cooperation applications, please try again tomorrow",
		Translate(LangEn, "cooperation.daily_limit"))
	// 站点条目校验复用申请侧的键，必须仍然可翻译
	assert.Equal(t,
		"站点名称长度必须在1-50之间",
		Translate(LangZhCN, "cooperation.site_name_length"))
}
