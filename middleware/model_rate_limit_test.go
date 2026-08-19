package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestModelRedisRateLimitUsesUTCRegardlessOfLocalTimezone(t *testing.T) {
	redisServer, redisClient := useRateLimitMiniRedis(t)
	previousLocation := time.Local
	time.Local = time.FixedZone("test-utc-plus-eight", 8*60*60)
	t.Cleanup(func() { time.Local = previousLocation })

	ctx := context.Background()
	recordKey := "rateLimit:model-utc-record"
	recordRedisRequest(ctx, redisClient, recordKey, 2)
	recorded, err := redisClient.LIndex(ctx, recordKey, 0).Result()
	require.NoError(t, err)
	recordedAt, err := time.Parse(modelRateLimitTimeFormat, recorded)
	require.NoError(t, err)
	assert.WithinDuration(t, time.Now().UTC(), recordedAt, 2*time.Second)

	checkKey := "rateLimit:model-utc-check"
	withinWindow := time.Now().UTC().Add(-30 * time.Second).Format(modelRateLimitTimeFormat)
	_, err = redisServer.Push(checkKey, withinWindow, withinWindow)
	require.NoError(t, err)
	allowed, err := checkRedisRateLimit(ctx, redisClient, checkKey, 2, 60)
	require.NoError(t, err)
	assert.False(t, allowed, "an existing UTC timestamp inside the window must remain limited on a non-UTC host")
}

func TestModelRequestClientRestriction(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousRateLimitEnabled := setting.ModelRequestRateLimitEnabled
	previousRestrictionEnabled := setting.ModelRequestClientRestrictionEnabled
	previousConfigs := setting.ModelRequestRateLimitGroup
	t.Cleanup(func() {
		setting.ModelRequestRateLimitEnabled = previousRateLimitEnabled
		setting.ModelRequestClientRestrictionEnabled = previousRestrictionEnabled
		setting.ModelRequestRateLimitMutex.Lock()
		setting.ModelRequestRateLimitGroup = previousConfigs
		setting.ModelRequestRateLimitMutex.Unlock()
	})

	setting.ModelRequestRateLimitEnabled = false
	setting.ModelRequestClientRestrictionEnabled = true
	require.NoError(t, setting.UpdateModelRequestRateLimitGroupByJSONString(`{
		"codex": {
			"max_requests": 10,
			"max_success": 8,
			"client_regex": "(?i)(?:codex|codex-tui)"
		},
		"claude": {
			"max_requests": 10,
			"max_success": 8,
			"client_regex": "(?i)(?:claude-cli|claude)"
		}
	}`))

	tests := []struct {
		name       string
		group      string
		userAgent  string
		originator string
		wantStatus int
		wantCalled bool
		wantClient string
	}{
		{
			name:       "user agent matches",
			group:      "codex",
			userAgent:  "Codex CLI/1.0",
			wantStatus: http.StatusNoContent,
			wantCalled: true,
		},
		{
			name:       "originator matches",
			group:      "codex",
			userAgent:  "custom-client",
			originator: "codex-tui",
			wantStatus: http.StatusNoContent,
			wantCalled: true,
		},
		{
			name:       "claude cli user agent matches",
			group:      "claude",
			userAgent:  "claude-cli/1.0",
			wantStatus: http.StatusNoContent,
			wantCalled: true,
		},
		{
			name:       "neither header matches",
			group:      "codex",
			userAgent:  "custom-client",
			originator: "other-client",
			wantStatus: http.StatusInternalServerError,
			wantCalled: false,
			wantClient: "Codex",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			called := false
			router := gin.New()
			router.Use(func(c *gin.Context) {
				common.SetContextKey(c, constant.ContextKeyTokenGroup, test.group)
				common.SetContextKey(c, constant.ContextKeyTokenId, 12)
				c.Set("id", 34)
				c.Next()
			})
			router.Use(ModelRequestRateLimit())
			router.GET("/test", func(c *gin.Context) {
				called = true
				c.Status(http.StatusNoContent)
			})

			request := httptest.NewRequest(http.MethodGet, "/test", nil)
			request.Header.Set("User-Agent", test.userAgent)
			request.Header.Set("originator", test.originator)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)

			assert.Equal(t, test.wantStatus, response.Code)
			assert.Equal(t, test.wantCalled, called)
			if test.wantStatus >= http.StatusBadRequest {
				var body struct {
					Error struct {
						Message string `json:"message"`
						Type    string `json:"type"`
						Code    string `json:"code"`
					} `json:"error"`
				}
				require.NoError(t, common.Unmarshal(response.Body.Bytes(), &body))
				assert.Equal(t, "client_restriction_error", body.Error.Type)
				assert.Equal(t, "client_not_allowed", body.Error.Code)
				assert.Contains(t, body.Error.Message, test.wantClient)
			}
		})
	}
}

func TestModelRequestClientRestrictionAllowsUnconfiguredGroup(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousRateLimitEnabled := setting.ModelRequestRateLimitEnabled
	previousRestrictionEnabled := setting.ModelRequestClientRestrictionEnabled
	t.Cleanup(func() {
		setting.ModelRequestRateLimitEnabled = previousRateLimitEnabled
		setting.ModelRequestClientRestrictionEnabled = previousRestrictionEnabled
	})

	setting.ModelRequestRateLimitEnabled = false
	setting.ModelRequestClientRestrictionEnabled = true

	router := gin.New()
	router.Use(func(c *gin.Context) {
		common.SetContextKey(c, constant.ContextKeyTokenGroup, "unconfigured")
		c.Next()
	})
	router.Use(ModelRequestRateLimit())
	router.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/test", nil))
	assert.Equal(t, http.StatusNoContent, response.Code)
}
