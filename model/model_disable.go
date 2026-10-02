package model

import (
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// disabledExactModelNames 保存被管理员停用的精确模型名（status != 1 且 name_rule = exact）。
// 使用原子指针整体替换，读路径无锁；集合为 nil 表示尚未加载，此时不拦截。
var disabledExactModelNames atomic.Pointer[map[string]struct{}]

// publishDisabledModels 从元数据快照重建停用集合。
// 与定价目录复用同一份 allMeta，避免额外查询。
func publishDisabledModels(records []Model) {
	set := make(map[string]struct{})
	for i := range records {
		if records[i].NameRule == NameRuleExact && records[i].Status != 1 {
			set[records[i].ModelName] = struct{}{}
		}
	}
	disabledExactModelNames.Store(&set)
}

// RefreshDisabledModels 从数据库重新加载停用模型集合并整体替换。
// 失败时保留上一次快照，避免数据库抖动期间误放行已停用模型。
func RefreshDisabledModels() {
	var names []string
	if err := DB.Model(&Model{}).
		Where("status <> ? AND name_rule = ?", 1, NameRuleExact).
		Pluck("model_name", &names).Error; err != nil {
		common.SysError("refresh disabled models failed: " + err.Error())
		return
	}
	set := make(map[string]struct{}, len(names))
	for _, name := range names {
		set[name] = struct{}{}
	}
	disabledExactModelNames.Store(&set)
}

// IsModelDisabled 判断请求的模型名是否被停用。
// 与渠道选择使用同一套路由归一化，防止通过 effort 后缀、thinking 后缀或 @ 修饰符绕过。
func IsModelDisabled(name string) bool {
	if name == "" {
		return false
	}
	set := disabledExactModelNames.Load()
	if set == nil {
		return false
	}
	if _, ok := (*set)[name]; ok {
		return true
	}
	_, ok := (*set)[ratio_setting.RoutingMatchModelName(name)]
	return ok
}
