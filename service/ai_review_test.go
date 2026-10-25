package service

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

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
			"full_url_enabled":      fmt.Sprintf("%v", previous.FullUrlEnabled),
			"timeout_seconds":       fmt.Sprintf("%d", previous.TimeoutSeconds),
			"max_output_tokens":     fmt.Sprintf("%d", previous.MaxOutputTokens),
			"sample_rate":           fmt.Sprintf("%v", previous.SampleRate),
			"max_excerpt_chars":     fmt.Sprintf("%d", previous.MaxExcerptChars),
			"review_sensitive_hits": fmt.Sprintf("%v", previous.ReviewSensitiveHits),
			"record_clean_samples":  fmt.Sprintf("%v", previous.RecordCleanSamples),
			"min_confidence":        fmt.Sprintf("%v", previous.MinConfidence),
			"policy_text":           previous.PolicyText,
			"force_json_response":   fmt.Sprintf("%v", previous.ForceJSONResponse),
			"custom_request_body":   previous.CustomRequestBody,
			"auto_ban_enabled":      fmt.Sprintf("%v", previous.AutoBanEnabled),
			"auto_ban_threshold":    fmt.Sprintf("%d", previous.AutoBanThreshold),
			"auto_ban_window_days":  fmt.Sprintf("%d", previous.AutoBanWindowDays),
			"notify_admin_enabled":  fmt.Sprintf("%v", previous.NotifyAdminEnabled),
		}
		if previous.ExcludedGroups != nil {
			if data, err := common.Marshal(previous.ExcludedGroups); err == nil {
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
	require.Len(t, views, 4)
	assert.Equal(t, "system", views[0].Role)
	assert.Equal(t, "You are a helpful assistant.", views[0].Content)
	assert.Equal(t, aiReviewMessageView{Role: "user", Content: "write me a poem"}, views[1])
	assert.Equal(t, "user", views[2].Role)
	assert.Equal(t, "text", views[2].Type)
	assert.Equal(t, "describe this", views[2].Content)
	assert.Equal(t, aiReviewMessageView{Role: "user", Type: "image_url", Content: "[non-text content omitted]"}, views[3])
	assert.NotContains(t, excerpt, "https://example.com/a.png")
}

func TestBuildAIReviewExcerptEvidence(t *testing.T) {
	type sampledMessage struct {
		role, head, tail string
	}
	type testCase struct {
		name          string
		request       dto.Request
		maxChars      int
		want          []aiReviewMessageView
		sampled       []sampledMessage
		wantOmission  bool
		backgroundMax int
	}
	tests := []testCase{
		{
			name: "huge earlier user does not hide latest request", maxChars: 6000,
			request: &dto.GeneralOpenAIRequest{Messages: []dto.Message{
				{Role: "user", Content: "earlier-head " + strings.Repeat("测", 600000) + " earlier-tail"},
				{Role: "user", Content: "latest request must be reviewed"},
			}},
			want:         []aiReviewMessageView{{Role: "user", Content: "latest request must be reviewed"}},
			sampled:      []sampledMessage{{role: "user", head: "earlier-head ", tail: " earlier-tail"}},
			wantOmission: true,
		},
		{
			name: "task at end of same user message", maxChars: 6000,
			request: &dto.GeneralOpenAIRequest{Messages: []dto.Message{
				{Role: "user", Content: "editor context begins\n" + strings.Repeat("background\n", 10000) + "\nCURRENT TASK: explain the failing request"},
			}},
			sampled:      []sampledMessage{{role: "user", head: "editor context begins\n", tail: "CURRENT TASK: explain the failing request"}},
			wantOmission: true,
		},
	}
	for _, maxChars := range []int{6000, 10000} {
		tests = append(tests, testCase{
			name: fmt.Sprintf("long system and user budget %d", maxChars), maxChars: maxChars,
			request: &dto.GeneralOpenAIRequest{Messages: []dto.Message{
				{Role: "system", Content: "system-head " + strings.Repeat("background ", 10000) + " system-tail"},
				{Role: "user", Content: "user-head " + strings.Repeat("context ", 10000) + " CURRENT USER TASK"},
			}},
			sampled: []sampledMessage{
				{role: "system", head: "system-head ", tail: " system-tail"},
				{role: "user", head: "user-head ", tail: " CURRENT USER TASK"},
			},
			wantOmission: true, backgroundMax: maxChars * 15 / 100,
		})
	}

	messages := make([]dto.Message, 250)
	var recent []aiReviewMessageView
	for i := range messages {
		messages[i] = dto.Message{Role: "user", Content: fmt.Sprintf("message-%03d", i)}
		if i >= 50 {
			recent = append(recent, aiReviewMessageView{Role: "user", Content: messages[i].Content.(string)})
		}
	}
	tests = append(tests, testCase{
		name: "more than 200 messages retain latest in order", maxChars: 20000,
		request: &dto.GeneralOpenAIRequest{Messages: messages}, want: recent, wantOmission: true,
	})

	skill := "<skills>Read SKILL.md before editing; preserve user intent.</skills>"
	for _, typed := range []bool{false, true} {
		var toolUse, toolResult any
		if typed {
			toolUse = []dto.ClaudeMediaMessage{{Type: "tool_use", Id: "skill-call", Name: "read_skill", Input: map[string]any{"path": "SKILL.md"}}}
			toolResult = []dto.ClaudeMediaMessage{{Type: "tool_result", ToolUseId: "skill-call", Content: []dto.ClaudeMediaMessage{{Type: "text", Text: &skill}}}}
		} else {
			toolUse = []any{map[string]any{"type": "tool_use", "id": "skill-call", "name": "read_skill", "input": map[string]any{"path": "SKILL.md"}}}
			toolResult = []any{map[string]any{"type": "tool_result", "tool_use_id": "skill-call", "content": []any{map[string]any{"type": "text", "text": skill}}}}
		}
		tests = append(tests, testCase{
			name: fmt.Sprintf("Claude tool_result skills typed=%v", typed), maxChars: 6000,
			request: &dto.ClaudeRequest{System: "be safe", Messages: []dto.ClaudeMessage{
				{Role: "assistant", Content: toolUse},
				{Role: "user", Content: toolResult},
				{Role: "user", Content: "CURRENT TASK: fix the parser"},
			}},
			want: []aiReviewMessageView{
				{Role: "system", Content: "be safe"},
				{Role: "assistant", Type: "tool_use", ToolName: "read_skill", ToolCallID: "skill-call", Content: `{"path":"SKILL.md"}`},
				{Role: "user", Type: "tool_result", ToolName: "read_skill", ToolCallID: "skill-call", Content: skill},
				{Role: "user", Content: "CURRENT TASK: fix the parser"},
			},
		})
	}

	tests = append(tests, testCase{
		name: "Responses preserve message roles and function or custom tool evidence", maxChars: 6000,
		request: &dto.OpenAIResponsesRequest{
			Instructions: json.RawMessage(`"answer briefly"`),
			Input: json.RawMessage(`[
				{"type":"message","role":"developer","content":[{"type":"input_text","text":"developer context"}]},
				{"type":"message","role":"assistant","content":[{"type":"output_text","text":"prior answer"}]},
				{"type":"function_call","name":"read_skill","call_id":"function-1","arguments":"{\"path\":\"SKILL.md\"}"},
				{"type":"function_call_output","call_id":"function-1","output":[{"type":"input_text","text":"function skill instructions"}]},
				{"type":"custom_tool_call","name":"custom_skill","call_id":"custom-1","input":"custom skill input"},
				{"type":"custom_tool_call_output","call_id":"custom-1","output":"custom skill result"},
				{"type":"message","role":"user","content":[{"type":"input_text","text":"latest Responses request"}]}
			]`),
		},
		want: []aiReviewMessageView{
			{Role: "system", Content: "answer briefly"},
			{Role: "developer", Type: "input_text", Content: "developer context"},
			{Role: "assistant", Type: "output_text", Content: "prior answer"},
			{Role: "assistant", Type: "function_call", ToolName: "read_skill", ToolCallID: "function-1", Content: `{"path":"SKILL.md"}`},
			{Role: "tool", Type: "function_call_output", ToolName: "read_skill", ToolCallID: "function-1", Content: "function skill instructions"},
			{Role: "assistant", Type: "custom_tool_call", ToolName: "custom_skill", ToolCallID: "custom-1", Content: "custom skill input"},
			{Role: "tool", Type: "custom_tool_call_output", ToolName: "custom_skill", ToolCallID: "custom-1", Content: "custom skill result"},
			{Role: "user", Type: "input_text", Content: "latest Responses request"},
		},
	})
	toolName := "read_skill"
	tests = append(tests, testCase{
		name: "OpenAI tool source metadata", maxChars: 6000,
		request: &dto.GeneralOpenAIRequest{Messages: []dto.Message{
			{Role: "assistant", ToolCalls: json.RawMessage(`[{"id":"openai-skill","type":"function","function":{"name":"read_skill","arguments":"{\"path\":\"SKILL.md\"}"}}]`)},
			{Role: "tool", Name: &toolName, ToolCallId: "openai-skill", Content: skill},
			{Role: "user", Content: "latest OpenAI request"},
		}},
		want: []aiReviewMessageView{
			{Role: "assistant", Type: "function_call", ToolName: "read_skill", ToolCallID: "openai-skill", Content: `{"path":"SKILL.md"}`},
			{Role: "tool", ToolName: "read_skill", ToolCallID: "openai-skill", Content: skill},
			{Role: "user", Content: "latest OpenAI request"},
		},
	})

	for _, maxChars := range []int{1000, 6000, 10000} {
		tests = append(tests, testCase{
			name: fmt.Sprintf("Unicode content rune budget %d", maxChars), maxChars: maxChars,
			request: &dto.GeneralOpenAIRequest{Messages: []dto.Message{
				{Role: "system", Content: strings.Repeat("背景🌏e\u0301", 10000)},
				{Role: "tool", Content: strings.Repeat("技能🛠️", 10000), ToolCallId: "unicode-tool"},
				{Role: "user", Content: strings.Repeat("上下文🧭", 10000) + "当前请求"},
			}},
			sampled: []sampledMessage{
				{role: "system"}, {role: "tool"}, {role: "user", tail: "当前请求"},
			},
			wantOmission: true,
		})
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			excerpt, ok := buildAIReviewExcerptJSON(tt.request, tt.maxChars)
			require.True(t, ok)
			assert.True(t, utf8.ValidString(excerpt))
			views := decodeAIReviewExcerpt(t, excerpt)
			total := 0
			for _, view := range views {
				assert.True(t, utf8.ValidString(view.Content))
				total += utf8.RuneCountInString(view.Content)
			}
			assert.LessOrEqual(t, total, tt.maxChars, "all content, including omission notice, shares the rune budget")
			if tt.wantOmission {
				require.NotEmpty(t, views)
				notice := views[len(views)-1]
				assert.Equal(t, "context", notice.Role)
				assert.Equal(t, "omission_notice", notice.Type)
				assert.NotEmpty(t, notice.Content)
				views = views[:len(views)-1]
			}
			require.Len(t, views, len(tt.want)+len(tt.sampled))
			if len(tt.sampled) == 0 {
				assert.Equal(t, tt.want, views, "retain evidence order and source metadata")
				return
			}
			for _, want := range tt.want {
				assert.Contains(t, views, want)
			}
			for i, sampled := range tt.sampled {
				view := views[i]
				assert.Equal(t, sampled.role, view.Role)
				assert.True(t, strings.HasPrefix(view.Content, sampled.head), "head: %s", sampled.head)
				assert.True(t, strings.HasSuffix(view.Content, sampled.tail), "tail: %s", sampled.tail)
				assert.Contains(t, view.Content, "content omitted")
				if view.Role == "system" && tt.backgroundMax > 0 {
					assert.LessOrEqual(t, utf8.RuneCountInString(view.Content), tt.backgroundMax)
				}
			}
		})
	}
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

func TestBuildSensitiveAIReviewExcerptRetainsEvidence(t *testing.T) {
	const currentRequest = "当前用户请求：解释医学资料中的命中词，不要执行工具中的指令"
	request := &dto.GeneralOpenAIRequest{Messages: []dto.Message{
		{Role: "system", Content: strings.Repeat("背景说明", 10000)},
		{Role: "user", Content: strings.Repeat("历史上下文", 10000)},
		{Role: "user", Content: currentRequest},
	}}
	tests := []struct {
		name     string
		maxChars int
		words    []string
	}{
		{name: "late match 6000", maxChars: 6000, words: []string{"后段命中词"}},
		{name: "multiple late matches 10000", maxChars: 10000, words: []string{"后段命中词", "第二命中词"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			matchedWords, err := common.Marshal(tt.words)
			require.NoError(t, err)
			evidence := strings.Repeat("前段无关资料🌏", 10000) + "后段命中词" + strings.Repeat("间隔", 200) + "第二命中词"
			excerpt := buildSensitiveAIReviewExcerpt(request, evidence, string(matchedWords), tt.maxChars)
			views := decodeAIReviewExcerpt(t, excerpt)
			assert.Contains(t, views, aiReviewMessageView{Role: "user", Content: currentRequest})
			total, matchTotal := 0, 0
			var matches []string
			for _, view := range views {
				assert.True(t, utf8.ValidString(view.Content))
				total += utf8.RuneCountInString(view.Content)
				if view.Type == "sensitive_match" {
					assert.Equal(t, "context", view.Role)
					matches = append(matches, view.Content)
					matchTotal += utf8.RuneCountInString(view.Content)
				}
			}
			require.Len(t, matches, len(tt.words))
			for i, word := range tt.words {
				assert.Contains(t, matches[i], word, "matched evidence must survive beyond the original prefix budget")
			}
			assert.LessOrEqual(t, matchTotal, tt.maxChars/3)
			assert.LessOrEqual(t, total, tt.maxChars)
		})
	}
}

func TestCallAIReviewModelSendsLatestRequestAndSkill(t *testing.T) {
	type capturedRequest struct {
		Model    string                `json:"model"`
		Messages []aiReviewChatMessage `json:"messages"`
		err      error
	}
	captured := make(chan capturedRequest, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload capturedRequest
		payload.err = common.DecodeJson(r.Body, &payload)
		captured <- payload
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"flagged\":false,\"category\":\"other\",\"confidence\":0.2,\"reason\":\"legitimate coding request\"}"}}]}`))
	}))
	t.Cleanup(server.Close)
	previousHTTPClient := httpClient
	httpClient = server.Client()
	t.Cleanup(func() { httpClient = previousHTTPClient })
	configureAIReviewTestSetting(t, map[string]string{
		"base_url": server.URL, "full_url_enabled": "false", "api_key": "test-key",
		"model_name": "review-model", "timeout_seconds": "5", "max_excerpt_chars": "6000",
	})
	const latestRequest = "CURRENT REQUEST: fix the parser using the loaded skill"
	const skill = "<skills>parser-skill: inspect the failing input before editing</skills>"
	request := &dto.ClaudeRequest{
		System: strings.Repeat("editor system background ", 10000),
		Messages: []dto.ClaudeMessage{
			{Role: "user", Content: strings.Repeat("old context ", 10000)},
			{Role: "user", Content: []dto.ClaudeMediaMessage{{Type: "tool_result", ToolUseId: "loaded-skill", Content: skill}}},
			{Role: "user", Content: latestRequest},
		},
	}
	excerpt, ok := buildAIReviewExcerptJSON(request, risk_setting.AIReviewMaxExcerptChars())
	require.True(t, ok)
	verdict, rawResponse, err := callAIReviewModel(&aiReviewItem{Source: model.AIReviewSourceSampled, Excerpt: excerpt})
	require.NoError(t, err)
	require.NotNil(t, verdict)
	assert.Empty(t, rawResponse)
	assert.False(t, verdict.Flagged)

	payload := <-captured
	require.NoError(t, payload.err)
	assert.Equal(t, "review-model", payload.Model)
	require.Len(t, payload.Messages, 2)
	assert.Equal(t, "system", payload.Messages[0].Role)
	assert.Equal(t, "user", payload.Messages[1].Role)
	var evidence struct {
		Source  string `json:"source"`
		Excerpt string `json:"excerpt"`
	}
	require.NoError(t, common.UnmarshalJsonStr(payload.Messages[1].Content, &evidence))
	assert.Equal(t, model.AIReviewSourceSampled, evidence.Source)
	assert.Equal(t, excerpt, evidence.Excerpt)
	views := decodeAIReviewExcerpt(t, evidence.Excerpt)
	assert.Contains(t, views, aiReviewMessageView{Role: "user", Content: latestRequest})
	assert.Contains(t, views, aiReviewMessageView{Role: "user", Type: "tool_result", ToolCallID: "loaded-skill", Content: skill})
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

func TestProcessAIReviewItemSampledCleanStoredWhenRecordingEnabled(t *testing.T) {
	db := setupAIReviewTestDB(t)
	server := fakeAIReviewServer(t, `{"flagged": false, "category": "other", "confidence": 0.1, "reason": "fine"}`, http.StatusOK)
	configureAIReviewTestSetting(t, map[string]string{
		"enabled": "true", "base_url": server.URL, "api_key": "test-key", "model_name": "review-model",
		"notify_admin_enabled": "false", "record_clean_samples": "true",
	})

	processAIReviewItem(processAIReviewFixtureItem(model.AIReviewSourceSampled))

	var records []model.AIReviewRecord
	require.NoError(t, db.Find(&records).Error)
	require.Len(t, records, 1)
	assert.Equal(t, model.AIReviewVerdictSafe, records[0].Verdict)
	assert.Equal(t, model.AIReviewStatusNoActionNeeded, records[0].AdminStatus)
	assert.Equal(t, "fine", records[0].Reason)
}

func TestProcessAIReviewItemSampledErrorStoredWhenRecordingEnabled(t *testing.T) {
	db := setupAIReviewTestDB(t)
	// 指向已关闭的端口，触发快速连接失败。
	configureAIReviewTestSetting(t, map[string]string{
		"enabled": "true", "base_url": "http://127.0.0.1:1", "api_key": "test-key", "model_name": "review-model",
		"notify_admin_enabled": "false", "record_clean_samples": "true",
	})

	processAIReviewItem(processAIReviewFixtureItem(model.AIReviewSourceSampled))

	var records []model.AIReviewRecord
	require.NoError(t, db.Find(&records).Error)
	require.Len(t, records, 1)
	assert.Equal(t, model.AIReviewVerdictError, records[0].Verdict)
	assert.Equal(t, model.AIReviewStatusNoActionNeeded, records[0].AdminStatus)
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

func TestTestAIReviewConnectionUsesGivenValues(t *testing.T) {
	setupAIReviewTestDB(t)
	var gotModel, gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Model string `json:"model"`
		}
		require.NoError(t, common.DecodeJson(r.Body, &payload))
		gotModel = payload.Model
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"OK"}}]}`))
	}))
	t.Cleanup(server.Close)

	result, err := TestAIReviewConnection(server.URL, false, "typed-key", "typed-model", "", 0, false)

	require.NoError(t, err)
	assert.Equal(t, "OK", result.Content)
	assert.NotEmpty(t, result.RawResponse, "raw response is returned for display")
	assert.NotEmpty(t, result.RequestURL)
	assert.Contains(t, result.RequestBody, `"model":"typed-model"`)
	assert.Equal(t, "typed-model", gotModel)
	assert.Equal(t, "Bearer typed-key", gotAuth)
}

func TestAIReviewChatCompletionsURL(t *testing.T) {
	tests := []struct {
		name    string
		baseUrl string
		fullURL bool
		want    string
	}{
		{name: "host only appends v1 path", baseUrl: "https://api.openai.com", want: "https://api.openai.com/v1/chat/completions"},
		{name: "v1 suffix keeps the version", baseUrl: "https://api.openai.com/v1", want: "https://api.openai.com/v1/chat/completions"},
		{name: "full url is used as is", baseUrl: "https://maas.example.com/v2/chat/completions", fullURL: true, want: "https://maas.example.com/v2/chat/completions"},
		{name: "full url responses path is used as is", baseUrl: "https://maas.example.com/v1/responses", fullURL: true, want: "https://maas.example.com/v1/responses"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, aiReviewChatCompletionsURL(tt.baseUrl, tt.fullURL))
		})
	}
}

func TestAIReviewConnectionChecksTransportAndUsesJSONSetting(t *testing.T) {
	previousHTTPClient := httpClient
	httpClient = &http.Client{}
	t.Cleanup(func() { httpClient = previousHTTPClient })

	tests := []struct {
		name       string
		forceJSON  bool
		extraBody  string
		status     int
		body       string
		wantFormat any
	}{
		{
			name:   "successful empty content confirms connectivity",
			status: http.StatusOK,
			body:   `{"choices":[{"message":{"content":null,"reasoning_content":"thinking"}}]}`,
		},
		{
			name:       "force JSON adds the upstream response format",
			forceJSON:  true,
			status:     http.StatusOK,
			body:       `{"choices":[{"message":{"content":"{\"status\":\"OK\"}"}}]}`,
			wantFormat: map[string]any{"type": "json_object"},
		},
		{
			name:       "custom JSON format takes precedence",
			forceJSON:  true,
			extraBody:  `{"response_format":{"type":"json_schema","json_schema":{"name":"connection"}}}`,
			status:     http.StatusOK,
			body:       `{"choices":[{"message":{"content":""}}]}`,
			wantFormat: map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "connection"}},
		},
		{
			name:   "upstream rejection remains a connection failure",
			status: http.StatusUnauthorized,
			body:   `{"error":{"message":"Invalid API key"}}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var payload struct {
				ResponseFormat any                   `json:"response_format"`
				Messages       []aiReviewChatMessage `json:"messages"`
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				require.NoError(t, common.DecodeJson(r.Body, &payload))
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			}))
			t.Cleanup(server.Close)

			result, err := TestAIReviewConnection(server.URL, false, "test-key", "review-model", tt.extraBody, 2048, tt.forceJSON)
			if tt.status == http.StatusOK {
				require.NoError(t, err)
				assert.Equal(t, "OK", result.Content)
				assert.Empty(t, result.Error)
			} else {
				require.Error(t, err)
				assert.NotEmpty(t, result.Error)
				assert.Empty(t, result.Content)
			}
			assert.Equal(t, tt.status, result.StatusCode)
			assert.Equal(t, tt.body, result.RawResponse)
			assert.Equal(t, tt.wantFormat, payload.ResponseFormat)
			require.Len(t, payload.Messages, 1)
			assert.Contains(t, payload.Messages[0].Content, "JSON")
		})
	}
}

func TestAIReviewChatStillRejectsEmptyReviewContent(t *testing.T) {
	previousHTTPClient := httpClient
	httpClient = &http.Client{}
	t.Cleanup(func() { httpClient = previousHTTPClient })
	const body = `{"choices":[{"message":{"content":null,"reasoning_content":"thinking"}}]}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)

	result, err := callAIReviewChat(server.URL, false, "test-key", "review-model", 5, 2048, []aiReviewChatMessage{{Role: "user", Content: "Review this request"}}, true, nil)
	require.Error(t, err)
	assert.Equal(t, "AI review response contains no content", err.Error())
	assert.Equal(t, body, result.RawResponse)
}

// 管理端从不回显密钥，因此留空测试必须回退到已保存的密钥。
func TestTestAIReviewConnectionFallsBackToStoredKey(t *testing.T) {
	setupAIReviewTestDB(t)
	configureAIReviewTestSetting(t, map[string]string{
		"enabled": "true", "base_url": "https://stored.example.com", "api_key": "stored-key", "model_name": "stored-model",
	})
	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"OK"}}]}`))
	}))
	t.Cleanup(server.Close)

	_, err := TestAIReviewConnection(server.URL, false, "", "typed-model", "", 0, false)

	require.NoError(t, err)
	assert.Equal(t, "Bearer stored-key", gotAuth)
}

func TestTestAIReviewConnectionRejectsIncompleteConfig(t *testing.T) {
	setupAIReviewTestDB(t)
	configureAIReviewTestSetting(t, map[string]string{"api_key": ""})
	tests := []struct {
		name     string
		baseUrl  string
		apiKey   string
		model    string
		wantText string
	}{
		{name: "missing base url", model: "model", apiKey: "key", wantText: "AI review endpoint is not configured"},
		{name: "unsupported scheme", baseUrl: "ftp://example.com", apiKey: "key", model: "model", wantText: "AI review endpoint URL must use http or https"},
		{name: "missing host", baseUrl: "https://", apiKey: "key", model: "model", wantText: "AI review endpoint URL must include a host"},
		{name: "missing key", baseUrl: "https://example.com", model: "model", wantText: "AI review endpoint is not configured"},
		{name: "missing model", baseUrl: "https://example.com", apiKey: "key", wantText: "Enter the review model to test the connection"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := TestAIReviewConnection(tt.baseUrl, false, tt.apiKey, tt.model, "", 0, false)
			require.Error(t, err)
			assert.Equal(t, tt.wantText, err.Error())
		})
	}
}
