package setting

import (
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

// SidebarModulesAdmin 选项原本只存在 common.OptionMap 里、由前端解析，后端没有
// 类型化视图。这里为服务端功能开关（如工单写接口 gate）提供可复用的解析与判定。
var sidebarModulesCache = struct {
	sync.RWMutex
	lastRaw string
	parsed  map[string]map[string]any
	valid   bool
}{}

// parseSidebarModulesAdminRaw 解析 SidebarModulesAdmin 原始 JSON，并按原始字符串
// 做一次性缓存。解析失败时 valid 为 false，调用方回落「默认全开」，
// 与前端 parseSidebarModulesAdmin 的回落行为一致。
func parseSidebarModulesAdminRaw(raw string) (map[string]map[string]any, bool) {
	sidebarModulesCache.RLock()
	if sidebarModulesCache.lastRaw == raw {
		parsed, valid := sidebarModulesCache.parsed, sidebarModulesCache.valid
		sidebarModulesCache.RUnlock()
		return parsed, valid
	}
	sidebarModulesCache.RUnlock()

	sidebarModulesCache.Lock()
	defer sidebarModulesCache.Unlock()
	if sidebarModulesCache.lastRaw == raw {
		return sidebarModulesCache.parsed, sidebarModulesCache.valid
	}

	parsed := map[string]map[string]any{}
	valid := true
	if strings.TrimSpace(raw) != "" {
		// 解析必须走 common 的 JSON 包装，禁止直接 encoding/json
		if err := common.UnmarshalJsonStr(raw, &parsed); err != nil || parsed == nil {
			parsed = map[string]map[string]any{}
			valid = false
		}
	}
	sidebarModulesCache.lastRaw = raw
	sidebarModulesCache.parsed = parsed
	sidebarModulesCache.valid = valid
	return parsed, valid
}

// IsSidebarModuleEnabled 判断 SidebarModulesAdmin 中某个 section.module 是否开启。
// 选项只在管理员保存设置时变化，因此按原始字符串缓存解析结果，避免每个请求都重复解析。
// 缺失值的判定与前端 mergeWithDefaultSidebarModules 合并后的结果对齐：section 或
// module 未出现在已保存配置中（例如历史部署没有 ticket 键）视为默认开启，
// 而 section.enabled 或 module 被显式置为 false 才算关闭。选项为空或解析失败时
// 返回 true（回落默认全开）。这里只做管理员层；用户个人的 sidebar_modules
// 收窄是个人显示偏好而非权限，不参与服务端 gate。
func IsSidebarModuleEnabled(section string, module string) bool {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap["SidebarModulesAdmin"]
	common.OptionMapRWMutex.RUnlock()

	parsed, valid := parseSidebarModulesAdminRaw(raw)
	if !valid {
		return true
	}
	sectionConfig, ok := parsed[section]
	if !ok || sectionConfig == nil {
		return true
	}
	if enabled, ok := sectionConfig["enabled"].(bool); ok && !enabled {
		return false
	}
	if value, ok := sectionConfig[module].(bool); ok && !value {
		return false
	}
	return true
}
