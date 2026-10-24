package service

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/risk_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupAIReviewTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMainDatabaseType, previousLogDatabaseType := common.MainDatabaseType(), common.LogDatabaseType()
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	db, err := gorm.Open(sqlite.Open("file:ai-review-test?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	model.DB, model.LOG_DB = db, db
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.AIReviewRecord{}))
	// InitHttpClient 仅在进程启动时执行，测试进程里为 nil；换成一个普通客户端。
	originalHTTPClient := httpClient
	httpClient = &http.Client{}
	t.Cleanup(func() {
		httpClient = originalHTTPClient
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

// configureAIReviewTestSetting 用与生产一致的写锁路径更新审核配置，并在测试结束
// 后恢复默认值。
func configureAIReviewTestSetting(t *testing.T, values map[string]string) {
	t.Helper()
	previous := risk_setting.GetAIReviewSetting()
	for key, value := range values {
		risk_setting.ApplyAIReviewConfigUpdate(key, value)
	}
	t.Cleanup(func() {
		restore := map[string]string{
			"enabled":  fmt.Sprintf("%v", previous.Enabled),
			"base_url": previous.BaseUrl, "api_key": previous.ApiKey, "model_name": previous.ModelName,
			"timeout_seconds":       fmt.Sprintf("%d", previous.TimeoutSeconds),
			"sample_rate":           fmt.Sprintf("%v", previous.SampleRate),
			"max_excerpt_chars":     fmt.Sprintf("%d", previous.MaxExcerptChars),
			"review_sensitive_hits": fmt.Sprintf("%v", previous.ReviewSensitiveHits),
			"min_confidence":        fmt.Sprintf("%v", previous.MinConfidence),
			"policy_text":           previous.PolicyText,
			"auto_ban_enabled":      fmt.Sprintf("%v", previous.AutoBanEnabled),
			"auto_ban_threshold":    fmt.Sprintf("%d", previous.AutoBanThreshold),
			"auto_ban_window_days":  fmt.Sprintf("%d", previous.AutoBanWindowDays),
			"notify_admin_enabled":  fmt.Sprintf("%v", previous.NotifyAdminEnabled),
		}
		if previous.ExcludedGroups != nil {
			if data, err := json.Marshal(previous.ExcludedGroups); err == nil {
				restore["excluded_groups"] = string(data)
			}
		} else {
			restore["excluded_groups"] = "[]"
		}
		for key, value := range restore {
			risk_setting.ApplyAIReviewConfigUpdate(key, value)
		}
	})
}

func TestParseAIReviewVerdict(t *testing.T) {
	tests := []struct {
		name           string
		content        string
		wantErr        bool
		wantFlagged    bool
		wantCategory   string
		wantConfidence float64
	}{
		{
			name:           "plain json",
			content:        `{"flagged": true, "category": "fraud", "confidence": 0.9, "reason": "phishing kit"}`,
			wantFlagged:    true,
			wantCategory:   "fraud",
			wantConfidence: 0.9,
		},
		{
			name:           "fenced json with prose",
			content:        "Here is my answer:\n```json\n{\"flagged\": false, \"category\": \"other\", \"confidence\": 0.2, \"reason\": \"normal coding help\"}\n```",
			wantFlagged:    false,
			wantCategory:   "other",
			wantConfidence: 0.2,
		},
		{
			name:           "unknown category normalized",
			content:        `{"flagged": true, "category": "cybercrime", "confidence": 1.7, "reason": "x"}`,
			wantFlagged:    true,
			wantCategory:   "other",
			wantConfidence: 1,
		},
		{
			name:    "no json object",
			content: "The content looks fine to me.",
			wantErr: true,
		},
		{
			name:    "broken json",
			content: `{"flagged": true, "category":`,
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			verdict, err := parseAIReviewVerdict(tt.content)
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.wantFlagged, verdict.Flagged)
			assert.Equal(t, tt.wantCategory, verdict.Category)
			assert.Equal(t, tt.wantConfidence, verdict.Confidence)
		})
	}
}

func decodeAIReviewExcerpt(t *testing.T, excerpt string) []aiReviewMessageView {
	t.Helper()
	var views []aiReviewMessageView
	require.NoError(t, common.UnmarshalJsonStr(excerpt, &views))
	return views
}

func TestBuildAIReviewExcerptGeneralOpenAIRequest(t *testing.T) {
	request := &dto.GeneralOpenAIRequest{
		Messages: []dto.Message{
			{Role: "system", Content: "You are a helpful assistant."},
			{Role: "user", Content: "write me a poem"},
			{Role: "user", Content: []any{
				map[string]any{"type": "text", "text": "describe this"},
				map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.com/a.png"}},
			}},
		},
	}
	excerpt, ok := buildAIReviewExcerptJSON(request, 1000)
	require.True(t, ok)
	views := decodeAIReviewExcerpt(t, excerpt)
	require.Len(t, views, 3)
	assert.Equal(t, "system", views[0].Role)
	assert.Equal(t, "You are a helpful assistant.", views[0].Content)
	assert.Equal(t, "user", views[2].Role)
	assert.Equal(t, "describe this", views[2].Content)
}

func TestBuildAIReviewExcerptTruncatesHugeContext(t *testing.T) {
	huge := strings.Repeat("测", 600000) // 60 万 token 量级的单条消息
	request := &dto.GeneralOpenAIRequest{
		Messages: []dto.Message{
			{Role: "user", Content: huge},
			{Role: "user", Content: "tail message must not be scanned"},
		},
	}
	excerpt, ok := buildAIReviewExcerptJSON(request, 6000)
	require.True(t, ok)
	views := decodeAIReviewExcerpt(t, excerpt)
	require.Len(t, views, 1)
	assert.Len(t, []rune(views[0].Content), 6000)
	assert.Equal(t, strings.Repeat("测", 6000), views[0].Content)
}

func TestBuildAIReviewExcerptCapsScannedMessages(t *testing.T) {
	messages := make([]dto.Message, 0, 250)
	for range 250 {
		messages = append(messages, dto.Message{Role: "user", Content: "hi"})
	}
	request := &dto.GeneralOpenAIRequest{Messages: messages}
	excerpt, ok := buildAIReviewExcerptJSON(request, 20000)
	require.True(t, ok)
	views := decodeAIReviewExcerpt(t, excerpt)
	assert.Len(t, views, aiReviewMaxScanMessages)
}

func TestBuildAIReviewExcerptClaudeAndResponses(t *testing.T) {
	claude := &dto.ClaudeRequest{
		System:   "be safe",
		Messages: []dto.ClaudeMessage{{Role: "user", Content: "hello"}},
	}
	excerpt, ok := buildAIReviewExcerptJSON(claude, 1000)
	require.True(t, ok)
	views := decodeAIReviewExcerpt(t, excerpt)
	require.Len(t, views, 2)
	assert.Equal(t, "system", views[0].Role)
	assert.Equal(t, "be safe", views[0].Content)
	assert.Equal(t, "user", views[1].Role)

	responses := &dto.OpenAIResponsesRequest{
		Instructions: json.RawMessage(`"answer briefly"`),
		Input:        json.RawMessage(`[{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"}]}]`),
	}
	excerpt, ok = buildAIReviewExcerptJSON(responses, 1000)
	require.True(t, ok)
	views = decodeAIReviewExcerpt(t, excerpt)
	require.GreaterOrEqual(t, len(views), 2)
	assert.Equal(t, "system", views[0].Role)
	assert.Equal(t, "answer briefly", views[0].Content)
}

func TestBuildAIReviewExcerptRejectsUnsupportedRequest(t *testing.T) {
	_, ok := buildAIReviewExcerptJSON(&dto.ImageRequest{}, 1000)
	assert.False(t, ok)
}

func TestEnqueueAIReviewDropsWhenQueueFull(t *testing.T) {
	// 先在原队列上完成 worker 启动（不发任何消息），再换成容量 1 的新队列；
	// workers 已绑定原队列，不会消费新队列，溢出行为因此是确定性的。
	aiReviewWorkersOnce.Do(startAIReviewWorkers)
	previousQueue := aiReviewQueue
	aiReviewQueue = make(chan *aiReviewItem, 1)
	t.Cleanup(func() { aiReviewQueue = previousQueue })

	droppedBefore := aiReviewDroppedTotal.Load()
	item := &aiReviewItem{Source: model.AIReviewSourceSampled}
	assert.True(t, enqueueAIReview(item))
	assert.False(t, enqueueAIReview(item))
	assert.Equal(t, int64(1), aiReviewDroppedTotal.Load()-droppedBefore)
	// 取出后可再次入队，证明丢弃不破坏队列状态。
	<-aiReviewQueue
	assert.True(t, enqueueAIReview(item))
}

// fakeAIReviewServer 返回固定判定内容的 OpenAI 兼容 chat/completions 服务。
func fakeAIReviewServer(t *testing.T, content string, status int) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}
		var payload struct {
			Model    string                `json:"model"`
			Messages []aiReviewChatMessage `json:"messages"`
		}
		require.NoError(t, common.DecodeJson(r.Body, &payload))
		require.Equal(t, "review-model", payload.Model)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(fmt.Sprintf(`{"choices":[{"message":{"content":%s}}]}`, mustMarshalString(content))))
	}))
	t.Cleanup(server.Close)
	return server
}

func mustMarshalString(s string) string {
	data, err := common.Marshal(s)
	if err != nil {
		panic(err)
	}
	return string(data)
}

func processAIReviewFixtureItem(source string) *aiReviewItem {
	return &aiReviewItem{
		UserId:    7,
		Username:  "tester",
		Source:    source,
		Excerpt:   `[{"role":"user","content":"evidence"}]`,
		CreatedAt: time.Now().Unix(),
	}
}

func TestProcessAIReviewItemFlaggedRecordsAndKeepsPending(t *testing.T) {
	db := setupAIReviewTestDB(t)
	require.NoError(t, db.Create(&model.User{Id: 7, Username: "tester"}).Error)
	server := fakeAIReviewServer(t, `{"flagged": true, "category": "fraud", "confidence": 0.95, "reason": "phishing"}`, http.StatusOK)
	configureAIReviewTestSetting(t, map[string]string{
		"enabled": "true", "base_url": server.URL, "api_key": "test-key", "model_name": "review-model",
		"notify_admin_enabled": "false",
	})

	processAIReviewItem(processAIReviewFixtureItem(model.AIReviewSourceSampled))

	var records []model.AIReviewRecord
	require.NoError(t, db.Find(&records).Error)
	require.Len(t, records, 1)
	assert.Equal(t, model.AIReviewVerdictFlagged, records[0].Verdict)
	assert.Equal(t, "fraud", records[0].Category)
	assert.Equal(t, model.AIReviewStatusPending, records[0].AdminStatus)
	// 自动封禁默认关闭：用户不受影响。
	var user model.User
	require.NoError(t, db.First(&user, 7).Error)
	assert.NotEqual(t, common.UserStatusDisabled, user.Status)
}

func TestProcessAIReviewItemAutoBansAtThreshold(t *testing.T) {
	db := setupAIReviewTestDB(t)
	require.NoError(t, db.Create(&model.User{Id: 7, Username: "tester", Status: common.UserStatusEnabled}).Error)
	server := fakeAIReviewServer(t, `{"flagged": true, "category": "violence", "confidence": 0.95, "reason": "threat"}`, http.StatusOK)
	configureAIReviewTestSetting(t, map[string]string{
		"enabled": "true", "base_url": server.URL, "api_key": "test-key", "model_name": "review-model",
		"notify_admin_enabled": "false", "auto_ban_enabled": "true", "auto_ban_threshold": "2", "auto_ban_window_days": "7",
	})
	// 窗口内已有一次历史违规，本次处理后累计达到阈值 2。
	require.NoError(t, db.Create(&model.AIReviewRecord{
		UserId: 7, Verdict: model.AIReviewVerdictFlagged, CreatedAt: time.Now().Add(-time.Hour).Unix(),
	}).Error)

	processAIReviewItem(processAIReviewFixtureItem(model.AIReviewSourceSampled))

	var user model.User
	require.NoError(t, db.First(&user, 7).Error)
	assert.Equal(t, common.UserStatusDisabled, user.Status)
	assert.Equal(t, model.UserBanReasonAIReview, user.BanReason)
}

func TestProcessAIReviewItemSensitiveHitSafeKeptForFalsePositiveReview(t *testing.T) {
	db := setupAIReviewTestDB(t)
	require.NoError(t, db.Create(&model.User{Id: 7, Username: "tester"}).Error)
	server := fakeAIReviewServer(t, `{"flagged": false, "category": "other", "confidence": 0.1, "reason": "medical discussion"}`, http.StatusOK)
	configureAIReviewTestSetting(t, map[string]string{
		"enabled": "true", "base_url": server.URL, "api_key": "test-key", "model_name": "review-model",
		"notify_admin_enabled": "false",
	})

	processAIReviewItem(processAIReviewFixtureItem(model.AIReviewSourceSensitiveHit))

	var records []model.AIReviewRecord
	require.NoError(t, db.Find(&records).Error)
	require.Len(t, records, 1)
	assert.Equal(t, model.AIReviewVerdictSafe, records[0].Verdict)
}

func TestProcessAIReviewItemSampledSafeNotStored(t *testing.T) {
	db := setupAIReviewTestDB(t)
	server := fakeAIReviewServer(t, `{"flagged": false, "category": "other", "confidence": 0.1, "reason": "fine"}`, http.StatusOK)
	configureAIReviewTestSetting(t, map[string]string{
		"enabled": "true", "base_url": server.URL, "api_key": "test-key", "model_name": "review-model",
		"notify_admin_enabled": "false",
	})

	processAIReviewItem(processAIReviewFixtureItem(model.AIReviewSourceSampled))

	var count int64
	require.NoError(t, db.Model(&model.AIReviewRecord{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestProcessAIReviewItemSensitiveHitErrorStoredForManualReview(t *testing.T) {
	db := setupAIReviewTestDB(t)
	// 指向已关闭的端口，触发快速连接失败。
	configureAIReviewTestSetting(t, map[string]string{
		"enabled": "true", "base_url": "http://127.0.0.1:1", "api_key": "test-key", "model_name": "review-model",
		"notify_admin_enabled": "false",
	})

	processAIReviewItem(processAIReviewFixtureItem(model.AIReviewSourceSensitiveHit))

	var records []model.AIReviewRecord
	require.NoError(t, db.Find(&records).Error)
	require.Len(t, records, 1)
	assert.Equal(t, model.AIReviewVerdictError, records[0].Verdict)
}

func TestAIReviewLowConfidenceFlagNotStoredAsFlagged(t *testing.T) {
	db := setupAIReviewTestDB(t)
	// 置信度 0.3 低于默认阈值 0.6：抽检来源既不计违规也不落库。
	server := fakeAIReviewServer(t, `{"flagged": true, "category": "other", "confidence": 0.3, "reason": "unsure"}`, http.StatusOK)
	configureAIReviewTestSetting(t, map[string]string{
		"enabled": "true", "base_url": server.URL, "api_key": "test-key", "model_name": "review-model",
		"notify_admin_enabled": "false",
	})

	processAIReviewItem(processAIReviewFixtureItem(model.AIReviewSourceSampled))

	var count int64
	require.NoError(t, db.Model(&model.AIReviewRecord{}).Count(&count).Error)
	assert.Zero(t, count)
}
