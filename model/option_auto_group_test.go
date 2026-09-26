package model

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateOptionValueRejectsInvalidMaxTokenAutoGroups(t *testing.T) {
	for _, value := range []string{"", "0", "-1", "1.5", "invalid"} {
		t.Run(value, func(t *testing.T) {
			assert.Error(t, validateOptionValue("MaxTokenAutoGroups", value))
		})
	}
	require.NoError(t, validateOptionValue("MaxTokenAutoGroups", "999999"))
}

// 测活配置的越界值（写入接口已拦截，这里覆盖历史值或手工改库的情况）在写入配置后
// 立即归一化，因此运行时读取不再需要每次请求都重写共享配置。
func TestProbeGuardOptionUpdateNormalizesSettings(t *testing.T) {
	settings := operation_setting.GetProbeGuardSettings()
	previous := *settings
	t.Cleanup(func() { *settings = previous })

	require.True(t, handleConfigUpdate("probe_guard.model_threshold", "3"))
	assert.Equal(t, 3, settings.ModelThreshold)

	require.True(t, handleConfigUpdate("probe_guard.model_threshold", "1"))
	assert.Equal(t, operation_setting.DefaultProbeGuardModelThreshold, settings.ModelThreshold)

	require.True(t, handleConfigUpdate("probe_guard.window_seconds", "99999"))
	assert.Equal(t, operation_setting.MaxProbeGuardWindowSeconds, settings.WindowSeconds)

	require.True(t, handleConfigUpdate("probe_guard.max_triggers", "42"))
	assert.Equal(t, operation_setting.MaxProbeGuardMaxTriggers, settings.MaxTriggers)
}
