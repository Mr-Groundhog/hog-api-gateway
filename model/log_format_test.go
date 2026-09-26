package model

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/log_setting"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestFormatUserLogsStripsQuotaSaturation verifies the admin-only quota
// saturation marker (nested under other.admin_info) is removed for non-admin
// log views, since formatUserLogs strips the whole admin_info object.
func TestFormatUserLogsStripsQuotaSaturation(t *testing.T) {
	other := common.MapToJsonStr(map[string]any{
		"model_price": 0.004,
		"admin_info": map[string]any{
			"quota_saturation": map[string]any{
				"op":      "QuotaFromDecimal",
				"kind":    "overflow",
				"clamped": common.MaxQuota,
			},
		},
	})
	logs := []*Log{{Other: other}}

	formatUserLogs(logs, 0)

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	_, hasAdminInfo := parsed["admin_info"]
	require.False(t, hasAdminInfo, "admin_info (and nested quota_saturation) must be stripped for non-admin views")
	// Non-admin billing fields remain visible.
	require.Contains(t, parsed, "model_price")
}

func TestTaskPluginLogVisibilityIsRoleSeparated(t *testing.T) {
	other := common.MapToJsonStr(map[string]any{
		"model_price": 1.25,
		"admin_info": map[string]any{
			"task_plugin": map[string]any{
				"key":     "document-parser",
				"name":    "Document Parser",
				"version": "1.2.3",
			},
		},
		"root_info": map[string]any{
			"upstream_task_id": "upstream-private",
			"task_plugin": map[string]any{
				"generation": 42,
			},
		},
	})

	t.Run("user", func(t *testing.T) {
		logs := []*Log{{Other: other}}
		formatUserLogs(logs, 0)

		parsed, err := common.StrToMap(logs[0].Other)
		require.NoError(t, err)
		assert.NotContains(t, parsed, "admin_info")
		assert.NotContains(t, parsed, "root_info")
		assert.Equal(t, 1.25, parsed["model_price"])
	})

	t.Run("admin", func(t *testing.T) {
		logs := []*Log{{Other: other}}
		FormatAdminLogs(logs)

		parsed, err := common.StrToMap(logs[0].Other)
		require.NoError(t, err)
		assert.Contains(t, parsed, "admin_info")
		assert.NotContains(t, parsed, "root_info")
	})

	t.Run("root", func(t *testing.T) {
		logs := []*Log{{Other: other}}
		FormatRootLogs(logs)

		parsed, err := common.StrToMap(logs[0].Other)
		require.NoError(t, err)
		assert.Contains(t, parsed, "admin_info")
		assert.Contains(t, parsed, "root_info")
	})
}

func TestLegacyLogOtherVisibilityIsRoleSeparated(t *testing.T) {
	other := common.MapToJsonStr(map[string]any{
		"request_path":  "/v1/chat/completions",
		"channel_id":    202,
		"channel_name":  "legacy-secret-channel",
		"channel_type":  1,
		"reject_reason": "legacy-policy-rejection",
		"admin_info": map[string]any{
			"existing_admin_field": "preserved",
		},
		"root_info": map[string]any{
			"upstream_request_id": "upstream-private",
		},
		"audit_info": map[string]any{
			"method": "POST",
		},
	})

	t.Run("user", func(t *testing.T) {
		logs := []*Log{{
			Id:          99,
			ChannelId:   77,
			ChannelName: "resolved-secret-channel",
			Other:       other,
		}}

		formatUserLogs(logs, 10)

		assert.Equal(t, 11, logs[0].Id)
		assert.Equal(t, 77, logs[0].ChannelId)
		assert.Empty(t, logs[0].ChannelName)
		parsed, err := common.StrToMap(logs[0].Other)
		require.NoError(t, err)
		assert.Equal(t, "/v1/chat/completions", parsed["request_path"])
		for _, key := range []string{
			"channel_id",
			"channel_name",
			"channel_type",
			"reject_reason",
			"admin_info",
			"root_info",
			"audit_info",
		} {
			assert.NotContains(t, parsed, key)
		}
	})

	t.Run("admin", func(t *testing.T) {
		logs := []*Log{{Other: other}}

		FormatAdminLogs(logs)

		parsed, err := common.StrToMap(logs[0].Other)
		require.NoError(t, err)
		assert.Equal(t, "legacy-secret-channel", parsed["channel_name"])
		assert.NotContains(t, parsed, "reject_reason")
		assert.NotContains(t, parsed, "root_info")
		assert.Contains(t, parsed, "audit_info")
		adminInfo, ok := parsed["admin_info"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "preserved", adminInfo["existing_admin_field"])
		assert.Equal(t, "legacy-policy-rejection", adminInfo["reject_reason"])
	})

	t.Run("root", func(t *testing.T) {
		logs := []*Log{{Other: other}}

		FormatRootLogs(logs)

		parsed, err := common.StrToMap(logs[0].Other)
		require.NoError(t, err)
		assert.Equal(t, "legacy-secret-channel", parsed["channel_name"])
		assert.NotContains(t, parsed, "reject_reason")
		assert.Contains(t, parsed, "root_info")
		assert.Contains(t, parsed, "audit_info")
		adminInfo, ok := parsed["admin_info"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "preserved", adminInfo["existing_admin_field"])
		assert.Equal(t, "legacy-policy-rejection", adminInfo["reject_reason"])
	})
}

func TestLegacyRejectReasonDoesNotOverrideScopedValue(t *testing.T) {
	other := common.MapToJsonStr(map[string]any{
		"reject_reason": "legacy-value",
		"admin_info": map[string]any{
			"reject_reason": "scoped-value",
		},
	})
	logs := []*Log{{Other: other}}

	FormatRootLogs(logs)

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	assert.NotContains(t, parsed, "reject_reason")
	adminInfo, ok := parsed["admin_info"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "scoped-value", adminInfo["reject_reason"])
}

func TestLegacyRejectReasonHandlesNullAdminInfo(t *testing.T) {
	logs := []*Log{{Other: `{"reject_reason":"legacy-value","admin_info":null}`}}

	FormatAdminLogs(logs)

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	assert.NotContains(t, parsed, "reject_reason")
	adminInfo, ok := parsed["admin_info"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "legacy-value", adminInfo["reject_reason"])
}

func TestLogFormattingPreservesLargeIntegerLexemes(t *testing.T) {
	const other = `{"public_id":9007199254740993,"admin_info":{"admin_id":9007199254740995},"root_info":{"generation":18446744073709551615}}`

	t.Run("user", func(t *testing.T) {
		logs := []*Log{{Other: other}}

		formatUserLogs(logs, 0)

		assert.Contains(t, logs[0].Other, `"public_id":9007199254740993`)
		assert.NotContains(t, logs[0].Other, "admin_id")
		assert.NotContains(t, logs[0].Other, "generation")
	})

	t.Run("admin", func(t *testing.T) {
		logs := []*Log{{Other: other}}

		FormatAdminLogs(logs)

		assert.Contains(t, logs[0].Other, `"public_id":9007199254740993`)
		assert.Contains(t, logs[0].Other, `"admin_id":9007199254740995`)
		assert.NotContains(t, logs[0].Other, "generation")
	})

	t.Run("root", func(t *testing.T) {
		logs := []*Log{{Other: other}}

		FormatRootLogs(logs)

		assert.Equal(t, other, logs[0].Other)
	})

	t.Run("unprivileged", func(t *testing.T) {
		const unprivileged = `{"public_id":9007199254740993,"model_price":0.004}`

		userLogs := []*Log{{Other: unprivileged}}
		formatUserLogs(userLogs, 0)
		assert.Equal(t, unprivileged, userLogs[0].Other)

		adminLogs := []*Log{{Other: unprivileged}}
		FormatAdminLogs(adminLogs)
		assert.Equal(t, unprivileged, adminLogs[0].Other)
	})
}

// TestResponseModelVisibilityIsConfigurable covers the
// log_setting.response_model_user_visible switch: the upstream response model is
// diagnostic metadata the operator may restrict to admins, and log owners keep
// their own request metadata either way.
func TestResponseModelVisibilityIsConfigurable(t *testing.T) {
	saved := config.GlobalConfig.ExportAllConfigs()
	t.Cleanup(func() { require.NoError(t, config.GlobalConfig.LoadFromDB(saved)) })

	// Ships enabled.
	assert.True(t, log_setting.IsResponseModelUserVisible())

	other := common.MapToJsonStr(map[string]any{
		"is_model_mapped":     true,
		"upstream_model_name": "gpt-4o-upstream",
		"response_model": map[string]any{
			"requested_model": "gpt-4o",
			"upstream_model":  "gpt-4o-upstream",
			"returned_model":  "gpt-4o-mini",
		},
	})

	t.Run("enabled", func(t *testing.T) {
		require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
			"log_setting.response_model_user_visible": "true",
		}))

		logs := []*Log{{Other: other}}
		formatUserLogs(logs, 0)

		parsed, err := common.StrToMap(logs[0].Other)
		require.NoError(t, err)
		assert.Contains(t, parsed, "response_model")
	})

	t.Run("disabled", func(t *testing.T) {
		require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
			"log_setting.response_model_user_visible": "false",
		}))

		userLogs := []*Log{{Other: other}}
		formatUserLogs(userLogs, 0)

		userParsed, err := common.StrToMap(userLogs[0].Other)
		require.NoError(t, err)
		assert.NotContains(t, userParsed, "response_model")
		assert.Equal(t, "gpt-4o-upstream", userParsed["upstream_model_name"])

		adminLogs := []*Log{{Other: other}}
		FormatAdminLogs(adminLogs)

		adminParsed, err := common.StrToMap(adminLogs[0].Other)
		require.NoError(t, err)
		assert.Contains(t, adminParsed, "response_model")
	})
}

// clientIdentifierRequest 构造带指定请求头的测试上下文，用于验证写入
// logs.user_agent 的客户端标识。
func clientIdentifierRequest(headers map[string]string) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	for key, value := range headers {
		c.Request.Header.Set(key, value)
	}
	return c
}

// TestClientIdentifierFromRequestFallsBackToDeviceHeaders verifies the value
// written to logs.user_agent: the client's User-Agent when present, otherwise
// a value synthesized from the headers that still identify the device.
func TestClientIdentifierFromRequestFallsBackToDeviceHeaders(t *testing.T) {
	cases := []struct {
		name    string
		headers map[string]string
		want    string
	}{
		{
			name: "user agent wins over device headers",
			headers: map[string]string{
				"User-Agent":         "  OpenAI/Python 1.0  ",
				"Sec-Ch-Ua-Platform": `"Windows"`,
			},
			want: "OpenAI/Python 1.0",
		},
		{
			name: "missing user agent falls back to device headers in order",
			headers: map[string]string{
				"Accept-Encoding":    "gzip, br",
				"Accept-Language":    "zh-CN,zh;q=0.9",
				"Sec-Ch-Ua":          `"Chromium";v="130"`,
				"Sec-Ch-Ua-Platform": `"Windows"`,
				"X-Client-Version":   "2.1.0",
			},
			want: `no-user-agent; sec-ch-ua-platform="Windows"; sec-ch-ua="Chromium";v="130"; x-client-version=2.1.0; accept-language=zh-CN,zh;q=0.9; accept-encoding=gzip, br`,
		},
		{
			name:    "headers that do not identify the device fall back to the bare marker",
			headers: map[string]string{"Authorization": "Bearer sk-test"},
			want:    "no-user-agent",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, ClientIdentifierFromRequest(clientIdentifierRequest(tc.headers)))
		})
	}

	assert.Empty(t, ClientIdentifierFromRequest(nil))
	assert.Empty(t, ClientIdentifierFromRequest(&gin.Context{}))
}

// TestClientIdentifierFromRequestTruncatesToColumnWidth verifies the identifier
// never exceeds the logs.user_agent column width: an over-long User-Agent would
// otherwise fail the whole log insert on MySQL strict mode and PostgreSQL.
func TestClientIdentifierFromRequestTruncatesToColumnWidth(t *testing.T) {
	oversized := strings.Repeat("客", logClientIdentifierMaxLen+40)

	identifier := ClientIdentifierFromRequest(clientIdentifierRequest(map[string]string{"User-Agent": oversized}))

	assert.Equal(t, logClientIdentifierMaxLen, len([]rune(identifier)))
	assert.True(t, utf8.ValidString(identifier))
	assert.Equal(t, strings.Repeat("客", logClientIdentifierMaxLen), identifier)
}
