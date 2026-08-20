package setting

import (
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

var CheckSensitiveEnabled = true
var CheckSensitiveOnPromptEnabled = true

//var CheckSensitiveOnCompletionEnabled = true

// StopOnSensitiveEnabled 如果检测到敏感词，是否立刻停止生成，否则替换敏感词
var StopOnSensitiveEnabled = true

// StreamCacheQueueLength 流模式缓存队列长度，0表示无缓存
var StreamCacheQueueLength = 0

// SensitiveWords 敏感词
// var SensitiveWords []string
var SensitiveWords = []string{
	"test_sensitive",
}

var sensitiveWordExcludedGroups = map[string]struct{}{}
var sensitiveWordExcludedGroupsMutex sync.RWMutex

func SensitiveWordsToString() string {
	return strings.Join(SensitiveWords, "\n")
}

func SensitiveWordsFromString(s string) {
	SensitiveWords = []string{}
	sw := strings.Split(s, "\n")
	for _, w := range sw {
		w = strings.TrimSpace(w)
		if w != "" {
			SensitiveWords = append(SensitiveWords, w)
		}
	}
}

func SensitiveWordExcludedGroupsToJSONString() string {
	sensitiveWordExcludedGroupsMutex.RLock()
	groups := make([]string, 0, len(sensitiveWordExcludedGroups))
	for group := range sensitiveWordExcludedGroups {
		groups = append(groups, group)
	}
	sensitiveWordExcludedGroupsMutex.RUnlock()

	sort.Strings(groups)
	jsonBytes, err := common.Marshal(groups)
	if err != nil {
		common.SysLog("error marshalling sensitive word excluded groups: " + err.Error())
		return "[]"
	}
	return string(jsonBytes)
}

func parseSensitiveWordExcludedGroups(jsonStr string) (map[string]struct{}, error) {
	groups := make([]string, 0)
	if strings.TrimSpace(jsonStr) != "" {
		if err := common.UnmarshalJsonStr(jsonStr, &groups); err != nil {
			return nil, err
		}
	}

	nextGroups := make(map[string]struct{}, len(groups))
	for _, group := range groups {
		if group == "" || strings.TrimSpace(group) != group {
			return nil, fmt.Errorf("sensitive word excluded group names cannot be empty or contain leading or trailing whitespace")
		}
		nextGroups[group] = struct{}{}
	}
	return nextGroups, nil
}

func ValidateSensitiveWordExcludedGroupsJSONString(jsonStr string) error {
	_, err := parseSensitiveWordExcludedGroups(jsonStr)
	return err
}

func UpdateSensitiveWordExcludedGroupsByJSONString(jsonStr string) error {
	nextGroups, err := parseSensitiveWordExcludedGroups(jsonStr)
	if err != nil {
		return err
	}

	sensitiveWordExcludedGroupsMutex.Lock()
	sensitiveWordExcludedGroups = nextGroups
	sensitiveWordExcludedGroupsMutex.Unlock()
	return nil
}

func IsSensitiveWordExcludedGroup(group string) bool {
	if group == "" {
		return false
	}
	sensitiveWordExcludedGroupsMutex.RLock()
	_, excluded := sensitiveWordExcludedGroups[group]
	sensitiveWordExcludedGroupsMutex.RUnlock()
	return excluded
}

func ShouldCheckPromptSensitive() bool {
	return CheckSensitiveEnabled && CheckSensitiveOnPromptEnabled
}

func ShouldCheckPromptSensitiveForGroup(group string) bool {
	return ShouldCheckPromptSensitive() && !IsSensitiveWordExcludedGroup(group)
}

//func ShouldCheckCompletionSensitive() bool {
//	return CheckSensitiveEnabled && CheckSensitiveOnCompletionEnabled
//}
