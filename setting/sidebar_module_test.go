package setting

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
)

func setSidebarModulesOption(t *testing.T, value string) {
	t.Helper()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	common.OptionMapRWMutex.Lock()
	previous, hadPrevious := common.OptionMap["SidebarModulesAdmin"]
	common.OptionMap["SidebarModulesAdmin"] = value
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		defer common.OptionMapRWMutex.Unlock()
		if hadPrevious {
			common.OptionMap["SidebarModulesAdmin"] = previous
		} else {
			delete(common.OptionMap, "SidebarModulesAdmin")
		}
	})
}

func TestIsSidebarModuleEnabled(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want bool
	}{
		{name: "empty option falls back to enabled", raw: "", want: true},
		{name: "invalid json falls back to enabled", raw: "{not-json", want: true},
		{name: "section missing defaults to enabled", raw: `{"personal":{"enabled":true,"chat":true}}`, want: true},
		{name: "module missing in configured section defaults to enabled", raw: `{"personal":{"enabled":true}}`, want: true},
		{name: "explicitly enabled", raw: `{"personal":{"enabled":true,"ticket":true}}`, want: true},
		{name: "section disabled wins over module enabled", raw: `{"personal":{"enabled":false,"ticket":true}}`, want: false},
		{name: "module disabled", raw: `{"personal":{"enabled":true,"ticket":false}}`, want: false},
		{name: "other section disabled does not affect", raw: `{"admin":{"enabled":false,"ticket":true}}`, want: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setSidebarModulesOption(t, tt.raw)
			assert.Equal(t, tt.want, IsSidebarModuleEnabled("personal", "ticket"))
		})
	}
}
