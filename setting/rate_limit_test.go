package setting

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseGroupRateLimitConfigSupportsLegacyAndObjectFormats(t *testing.T) {
	configs, err := ParseGroupRateLimitConfig(`{
		"legacy": [15, 13],
		"codex": {
			"max_requests": 10,
			"max_success": 8,
			"client_regex": "(?i)(?:codex|codex-tui)"
		}
	}`)
	require.NoError(t, err)

	assert.Equal(t, 15, configs["legacy"].MaxRequests)
	assert.Equal(t, 13, configs["legacy"].MaxSuccess)
	assert.Empty(t, configs["legacy"].ClientRegex)
	assert.Nil(t, configs["legacy"].CompiledClientRegex)

	assert.Equal(t, 10, configs["codex"].MaxRequests)
	assert.Equal(t, 8, configs["codex"].MaxSuccess)
	require.NotNil(t, configs["codex"].CompiledClientRegex)
	assert.True(t, configs["codex"].CompiledClientRegex.MatchString("Codex CLI"))
}

func TestParseGroupRateLimitConfigNormalizesLegacyClaudeRegex(t *testing.T) {
	configs, err := ParseGroupRateLimitConfig(`{
		"claude": {
			"max_requests": 10,
			"max_success": 8,
			"client_regex": "(?i)(?:claude[-_ ]?code|claude-code-cli)"
		}
	}`)
	require.NoError(t, err)

	assert.Equal(t, `(?i)(?:claude-cli|claude)`, configs["claude"].ClientRegex)
	assert.True(t, configs["claude"].CompiledClientRegex.MatchString("claude-cli/1.0"))
	assert.Equal(t, "Claude", ClientRestrictionName(configs["claude"].ClientRegex))
}

func TestParseGroupRateLimitConfigRejectsInvalidValues(t *testing.T) {
	tests := []struct {
		name      string
		value     string
		wantError string
	}{
		{
			name:      "legacy length",
			value:     `{"default":[1]}`,
			wantError: "exactly 2 values",
		},
		{
			name:      "missing object field",
			value:     `{"default":{"max_success":1}}`,
			wantError: "missing max_requests",
		},
		{
			name:      "unknown object field",
			value:     `{"default":{"max_requests":1,"max_success":1,"extra":true}}`,
			wantError: "unknown field extra",
		},
		{
			name:      "negative request limit",
			value:     `{"default":{"max_requests":-1,"max_success":1}}`,
			wantError: "max_requests must be at least 0",
		},
		{
			name:      "invalid regex",
			value:     `{"default":{"max_requests":1,"max_success":1,"client_regex":"("}}`,
			wantError: "invalid client_regex",
		},
		{
			name:      "surrounding regex whitespace",
			value:     `{"default":{"max_requests":1,"max_success":1,"client_regex":" codex"}}`,
			wantError: "leading or trailing whitespace",
		},
		{
			name: "regex too long",
			value: `{"default":{"max_requests":1,"max_success":1,"client_regex":"` +
				strings.Repeat("a", maxClientRegexLength+1) + `"}}`,
			wantError: "must not exceed 512 characters",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ParseGroupRateLimitConfig(test.value)
			require.Error(t, err)
			assert.Contains(t, err.Error(), test.wantError)
		})
	}
}

func TestUpdateModelRequestRateLimitGroupIsAtomic(t *testing.T) {
	previousConfigs := ModelRequestRateLimitGroup
	t.Cleanup(func() {
		ModelRequestRateLimitMutex.Lock()
		ModelRequestRateLimitGroup = previousConfigs
		ModelRequestRateLimitMutex.Unlock()
	})

	require.NoError(t, UpdateModelRequestRateLimitGroupByJSONString(
		`{"default":{"max_requests":10,"max_success":8,"client_regex":"codex"}}`,
	))
	before, found := GetGroupRateLimitConfig("default")
	require.True(t, found)

	err := UpdateModelRequestRateLimitGroupByJSONString(
		`{"default":{"max_requests":10,"max_success":8,"client_regex":"("}}`,
	)
	require.Error(t, err)

	after, found := GetGroupRateLimitConfig("default")
	require.True(t, found)
	assert.Equal(t, before.ClientRegex, after.ClientRegex)
	require.NotNil(t, after.CompiledClientRegex)
	assert.True(t, after.CompiledClientRegex.MatchString("codex"))
}

func TestModelRequestRateLimitGroup2JSONStringUsesObjectFormat(t *testing.T) {
	previousConfigs := ModelRequestRateLimitGroup
	t.Cleanup(func() {
		ModelRequestRateLimitMutex.Lock()
		ModelRequestRateLimitGroup = previousConfigs
		ModelRequestRateLimitMutex.Unlock()
	})

	require.NoError(t, UpdateModelRequestRateLimitGroupByJSONString(`{"default":[15,13]}`))
	assert.JSONEq(t, `{
		"default": {
			"max_requests": 15,
			"max_success": 13
		}
	}`, ModelRequestRateLimitGroup2JSONString())
}
