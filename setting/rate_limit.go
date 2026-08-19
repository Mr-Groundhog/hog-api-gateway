package setting

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
)

const maxClientRegexLength = 512

const (
	claudeClientRegex       = `(?i)(?:claude-cli|claude)`
	legacyClaudeClientRegex = `(?i)(?:claude[-_ ]?code|claude-code-cli)`
)

type GroupRateLimitConfig struct {
	MaxRequests int    `json:"max_requests"`
	MaxSuccess  int    `json:"max_success"`
	ClientRegex string `json:"client_regex,omitempty"`

	CompiledClientRegex *regexp.Regexp `json:"-"`
}

func normalizeClientRegex(clientRegex string) string {
	if clientRegex == legacyClaudeClientRegex {
		return claudeClientRegex
	}
	return clientRegex
}

// ClientRestrictionName returns the friendly name used in client restriction errors.
func ClientRestrictionName(clientRegex string) string {
	switch normalizeClientRegex(clientRegex) {
	case `(?i)(?:codex|codex-tui)`:
		return "Codex"
	case claudeClientRegex:
		return "Claude"
	default:
		return ""
	}
}

var ModelRequestRateLimitEnabled = false
var ModelRequestClientRestrictionEnabled = false
var ModelRequestRateLimitDurationMinutes = 1
var ModelRequestRateLimitCount = 0
var ModelRequestRateLimitSuccessCount = 1000
var ModelRequestRateLimitGroup = map[string]GroupRateLimitConfig{}
var ModelRequestRateLimitMutex sync.RWMutex

func ModelRequestRateLimitGroup2JSONString() string {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	jsonBytes, err := common.Marshal(ModelRequestRateLimitGroup)
	if err != nil {
		common.SysLog("error marshalling model request rate limits: " + err.Error())
	}
	return string(jsonBytes)
}

func ParseGroupRateLimitConfig(jsonStr string) (map[string]GroupRateLimitConfig, error) {
	if common.GetJsonType(json.RawMessage(jsonStr)) != "object" {
		return nil, fmt.Errorf("group rate limits must be a JSON object")
	}

	var rawConfigs map[string]json.RawMessage
	if err := common.UnmarshalJsonStr(jsonStr, &rawConfigs); err != nil {
		return nil, err
	}

	configs := make(map[string]GroupRateLimitConfig, len(rawConfigs))
	for group, rawConfig := range rawConfigs {
		if group == "" || strings.TrimSpace(group) != group {
			return nil, fmt.Errorf("group name cannot be empty or contain leading or trailing whitespace")
		}

		var config GroupRateLimitConfig
		switch common.GetJsonType(rawConfig) {
		case "array":
			var legacyConfig []int
			if err := common.Unmarshal(rawConfig, &legacyConfig); err != nil {
				return nil, fmt.Errorf("group %s has invalid legacy rate limit config: %w", group, err)
			}
			if len(legacyConfig) != 2 {
				return nil, fmt.Errorf("group %s legacy rate limit config must contain exactly 2 values", group)
			}
			config.MaxRequests = legacyConfig[0]
			config.MaxSuccess = legacyConfig[1]
		case "object":
			var fields map[string]json.RawMessage
			if err := common.Unmarshal(rawConfig, &fields); err != nil {
				return nil, fmt.Errorf("group %s has invalid rate limit config: %w", group, err)
			}
			if _, found := fields["max_requests"]; !found {
				return nil, fmt.Errorf("group %s rate limit config is missing max_requests", group)
			}
			if _, found := fields["max_success"]; !found {
				return nil, fmt.Errorf("group %s rate limit config is missing max_success", group)
			}
			for field := range fields {
				switch field {
				case "max_requests", "max_success", "client_regex":
				default:
					return nil, fmt.Errorf("group %s rate limit config contains unknown field %s", group, field)
				}
			}
			if err := common.Unmarshal(rawConfig, &config); err != nil {
				return nil, fmt.Errorf("group %s has invalid rate limit config: %w", group, err)
			}
		default:
			return nil, fmt.Errorf("group %s rate limit config must be an object or a 2-item array", group)
		}

		config.ClientRegex = normalizeClientRegex(config.ClientRegex)

		if config.MaxRequests < 0 || config.MaxSuccess < 1 {
			return nil, fmt.Errorf("group %s has invalid rate limit values: max_requests must be at least 0 and max_success must be at least 1", group)
		}
		if config.MaxRequests > math.MaxInt32 || config.MaxSuccess > math.MaxInt32 {
			return nil, fmt.Errorf("group %s rate limit values must not exceed 2147483647", group)
		}
		if strings.TrimSpace(config.ClientRegex) != config.ClientRegex {
			return nil, fmt.Errorf("group %s client_regex cannot contain leading or trailing whitespace", group)
		}
		if utf8.RuneCountInString(config.ClientRegex) > maxClientRegexLength {
			return nil, fmt.Errorf("group %s client_regex must not exceed %d characters", group, maxClientRegexLength)
		}
		if config.ClientRegex != "" {
			compiledRegex, err := regexp.Compile(config.ClientRegex)
			if err != nil {
				return nil, fmt.Errorf("group %s has invalid client_regex: %w", group, err)
			}
			config.CompiledClientRegex = compiledRegex
		}

		configs[group] = config
	}

	return configs, nil
}

func UpdateModelRequestRateLimitGroupByJSONString(jsonStr string) error {
	configs, err := ParseGroupRateLimitConfig(jsonStr)
	if err != nil {
		return err
	}

	ModelRequestRateLimitMutex.Lock()
	ModelRequestRateLimitGroup = configs
	ModelRequestRateLimitMutex.Unlock()
	return nil
}

func GetGroupRateLimitConfig(group string) (GroupRateLimitConfig, bool) {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	config, found := ModelRequestRateLimitGroup[group]
	return config, found
}

func GetGroupRateLimit(group string) (totalCount, successCount int, found bool) {
	config, found := GetGroupRateLimitConfig(group)
	if !found {
		return 0, 0, false
	}
	return config.MaxRequests, config.MaxSuccess, true
}

func CheckModelRequestRateLimitGroup(jsonStr string) error {
	_, err := ParseGroupRateLimitConfig(jsonStr)
	return err
}
