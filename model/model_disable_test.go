package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func useDisabledModelSet(t *testing.T, records []Model) {
	t.Helper()
	publishDisabledModels(records)
	t.Cleanup(func() { disabledExactModelNames.Store(nil) })
}

func TestPublishDisabledModelsOnlyTracksExactDisabledRows(t *testing.T) {
	useDisabledModelSet(t, []Model{
		{ModelName: "zz-publish-disabled", NameRule: NameRuleExact, Status: 0},
		{ModelName: "zz-publish-enabled", NameRule: NameRuleExact, Status: 1},
		{ModelName: "zz-publish-prefix", NameRule: NameRulePrefix, Status: 0},
		{ModelName: "zz-publish-contains", NameRule: NameRuleContains, Status: 0},
		{ModelName: "zz-publish-suffix", NameRule: NameRuleSuffix, Status: 0},
	})

	assert.True(t, IsModelDisabled("zz-publish-disabled"))
	assert.False(t, IsModelDisabled("zz-publish-enabled"))
	assert.False(t, IsModelDisabled("zz-publish-prefix-anything"))
	assert.False(t, IsModelDisabled("zz-publish-contains"))
	assert.False(t, IsModelDisabled("zz-publish-suffix"))
}

func TestIsModelDisabledMatchesRoutingVariants(t *testing.T) {
	useDisabledModelSet(t, []Model{{ModelName: "gpt-4o", NameRule: NameRuleExact, Status: 0}})

	for _, tc := range []struct {
		name  string
		model string
		want  bool
	}{
		{"exact name", "gpt-4o", true},
		{"effort suffix normalizes to the disabled base", "gpt-4o-high", true},
		{"modifier tail normalizes to the disabled base", "gpt-4o@thinking:on", true},
		{"unrelated model stays allowed", "gpt-4o-mini", false},
		{"gpt thinking suffix is not normalized", "gpt-4o-thinking", false},
		{"empty name is never disabled", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, IsModelDisabled(tc.model))
		})
	}
}

func TestIsModelDisabledFailsOpenBeforeCacheLoad(t *testing.T) {
	disabledExactModelNames.Store(nil)
	t.Cleanup(func() { disabledExactModelNames.Store(nil) })

	assert.False(t, IsModelDisabled("gpt-4o"))
}

func TestRefreshDisabledModelsLoadsExactRowsFromDB(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Model{}))
	rows := []Model{
		{ModelName: "zz-refresh-disabled", NameRule: NameRuleExact, Status: 1},
		{ModelName: "zz-refresh-enabled", NameRule: NameRuleExact, Status: 1},
		{ModelName: "zz-refresh-prefix", NameRule: NameRulePrefix, Status: 1},
	}
	for i := range rows {
		require.NoError(t, DB.Create(&rows[i]).Error)
	}
	// 状态列带 gorm default:1，零值创建会被默认值覆盖，这里显式改成 0
	require.NoError(t, DB.Model(&Model{}).Where("model_name IN ?", []string{"zz-refresh-disabled", "zz-refresh-prefix"}).Update("status", 0).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Where("model_name LIKE ?", "zz-refresh-%").Delete(&Model{}).Error)
		disabledExactModelNames.Store(nil)
	})

	RefreshDisabledModels()

	assert.True(t, IsModelDisabled("zz-refresh-disabled"))
	assert.False(t, IsModelDisabled("zz-refresh-enabled"))
	assert.False(t, IsModelDisabled("zz-refresh-prefix"))
}
