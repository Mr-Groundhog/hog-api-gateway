package service

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/glebarez/sqlite"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/risk_setting"
)

func newRiskTestDB(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	db, err := gorm.Open(sqlite.Open(t.TempDir()+"/risk.db"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.TokenRiskEvent{}))
	model.DB = db
	t.Cleanup(func() {
		sqlDB, _ := db.DB()
		if sqlDB != nil {
			_ = sqlDB.Close()
		}
		model.DB = previousDB
	})
}

// newRiskTestRedis 把 common.RDB 指向 miniredis，供风控用例验证 Redis 侧行为。
func newRiskTestRedis(t *testing.T) {
	t.Helper()
	redisServer := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	previousRDB, previousRedisEnabled := common.RDB, common.RedisEnabled
	common.RDB = client
	common.RedisEnabled = true
	t.Cleanup(func() {
		common.RDB = previousRDB
		common.RedisEnabled = previousRedisEnabled
	})
}

// riskHeadersClient 构造只带 User-Agent 的请求头取值函数。
func riskHeadersClient(userAgent string) func(string) string {
	return func(name string) string {
		if name == "User-Agent" {
			return userAgent
		}
		return ""
	}
}

// resetRiskTrackerForTest 重置在途计数器单例并设置指纹盐，让请求路径使用本测试
// 配置好的 Redis 实现。
func resetRiskTrackerForTest(t *testing.T) {
	t.Helper()
	risk_setting.SetFingerprintSalt("test-salt")
	riskTrackerOnce = sync.Once{}
	riskTrackerImpl = nil
	t.Cleanup(func() {
		risk_setting.SetFingerprintSalt("")
		riskTrackerOnce = sync.Once{}
		riskTrackerImpl = nil
	})
}

func TestComputeClientFingerprintIsStableAndSaltSensitive(t *testing.T) {
	headers := func(name string) string {
		switch name {
		case "User-Agent":
			return "claude-cli/1.0.34"
		case "Accept":
			return "application/json"
		default:
			return ""
		}
	}

	fp1 := ComputeClientFingerprint(headers, "salt-a")
	fp2 := ComputeClientFingerprint(headers, "salt-a")
	assert.Equal(t, fp1, fp2, "same headers and salt must produce the same fingerprint")
	assert.Len(t, fp1, 16)

	fpOther := ComputeClientFingerprint(headers, "salt-b")
	assert.NotEqual(t, fp1, fpOther, "different salt must change the fingerprint")

	fpNoSalt := ComputeClientFingerprint(headers, "")
	assert.Empty(t, fpNoSalt, "empty salt disables fingerprinting")

	missing := func(string) string { return "" }
	fpMissing := ComputeClientFingerprint(missing, "salt-a")
	assert.NotEmpty(t, fpMissing, "missing headers still hash via placeholders")
	assert.NotEqual(t, fp1, fpMissing)
}

func TestMemoryRiskInflightTrackerConcurrencySignals(t *testing.T) {
	tracker := &memoryRiskInflightTracker{}
	tokenId := 101

	// 同一客户端（同指纹）8 个并发（子代理场景）：单一指纹计数高，指纹数为 1。
	for range 8 {
		tracker.Enter(tokenId, "fp-same")
	}
	// 离开一个后单指纹在途 7，远低于单指纹并发阈值（默认 20），无事件。
	assert.Nil(t, tracker.Leave(tokenId, "fp-same"))

	// 第二、三个不同指纹加入后：三个指纹各有 2 个在途请求。此时离开一个，
	// 指纹桶数仍为 3（达到阈值），产生 concurrent_fp 事件。
	for range 2 {
		tracker.Enter(tokenId, "fp-b")
	}
	for range 2 {
		tracker.Enter(tokenId, "fp-c")
	}
	event := tracker.Leave(tokenId, "fp-c")
	require.NotNil(t, event, "3 distinct in-flight fingerprints must trigger concurrent_fp")
	assert.Equal(t, risk_setting.RiskEventConcurrentFp, event.EventType)
	assert.Equal(t, int64(3), event.Observed)
	assert.Equal(t, risk_setting.GetSetting().MaxConcurrentFingerprints, event.Threshold)
	require.Len(t, event.Fingerprints, 3)
	requests := make([]int64, 0, len(event.Fingerprints))
	for _, ref := range event.Fingerprints {
		requests = append(requests, ref.Requests)
	}
	assert.ElementsMatch(t, []int64{7, 2, 1}, requests,
		"并发观察结果要带出每个在途指纹及其在途请求数")

	// 清空全部在途计数。
	for range 7 {
		tracker.Leave(tokenId, "fp-same")
	}
	tracker.Leave(tokenId, "fp-b")
	tracker.Leave(tokenId, "fp-c")
	assert.Nil(t, tracker.Leave(tokenId, "fp-same"))
}

func TestRecordTokenRiskEventHourlyDedup(t *testing.T) {
	newRiskTestDB(t)
	now := time.Now()
	for range 3 {
		model.RecordTokenRiskEventFromSample(1, 42, risk_setting.RiskEventConcurrentFp,
			`{"concurrent_fingerprints":3}`, now)
	}

	events, total, err := model.GetTokenRiskEvents(model.TokenRiskEventFilter{}, 0, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total, "same token/type/hour must dedupe to one event")
	require.Len(t, events, 1)
	assert.Equal(t, 42, events[0].TokenId)
	assert.Equal(t, risk_setting.RiskEventConcurrentFp, events[0].EventType)
}

// TestRiskCrossUserEvidenceIsValidJSON 验证跨用户指纹证据是合法 JSON 且带出
// 关联账号与客户端标识。历史上证据由 fmt.Sprintf("%q") 拼接切片，元素间缺逗号
// 导致前端 JSON.parse 失败并隐藏证据。
func TestRiskCrossUserEvidenceIsValidJSON(t *testing.T) {
	evidence := marshalRiskEvidence(riskCrossUserEvidence{
		Fingerprint: "0123456789abcdef",
		riskClientIdentity: riskClientIdentity{
			UserAgent:     "claude-cli/1.0.34 (external, cli)",
			ClientVersion: "1.0.34",
			Platform:      "macOS",
		},
		UserIds:   []int{7, 12, 305},
		Usernames: []string{"alice", "bob", "#305"},
		UserCount: 3,
		Threshold: 3,
	})

	var parsed struct {
		Fingerprint   string   `json:"fingerprint"`
		UserAgent     string   `json:"user_agent"`
		ClientVersion string   `json:"client_version"`
		Platform      string   `json:"platform"`
		UserIds       []int    `json:"user_ids"`
		Usernames     []string `json:"usernames"`
		UserCount     int      `json:"user_count"`
		Threshold     int      `json:"threshold"`
	}
	require.NoError(t, common.UnmarshalJsonStr(evidence, &parsed),
		"cross-user evidence must be valid JSON")
	assert.Equal(t, "0123456789abcdef", parsed.Fingerprint)
	assert.Equal(t, "claude-cli/1.0.34 (external, cli)", parsed.UserAgent,
		"evidence must show which client the fingerprint belongs to")
	assert.Equal(t, "1.0.34", parsed.ClientVersion)
	assert.Equal(t, "macOS", parsed.Platform)
	assert.Equal(t, []int{7, 12, 305}, parsed.UserIds, "user_ids must list every involved account")
	assert.Equal(t, []string{"alice", "bob", "#305"}, parsed.Usernames,
		"evidence must name the accounts sharing the fingerprint")
	assert.Equal(t, 3, parsed.UserCount)
	assert.Equal(t, 3, parsed.Threshold)

	withoutClient := marshalRiskEvidence(riskCrossUserEvidence{
		Fingerprint: "0123456789abcdef",
		UserIds:     []int{7},
		Usernames:   []string{"alice"},
		UserCount:   1,
		Threshold:   1,
	})
	assert.NotContains(t, withoutClient, "user_agent",
		"missing client headers must not produce empty evidence fields")
}

// TestRiskClientIdentityFromHeaders 验证客户端标识的取值、去空白与超长截断。
func TestRiskClientIdentityFromHeaders(t *testing.T) {
	headers := func(values map[string]string) func(string) string {
		return func(name string) string { return values[name] }
	}

	client := riskClientIdentityFromHeaders(headers(map[string]string{
		"User-Agent":         "  claude-cli/1.0.34 (external, cli)  ",
		"X-Client-Version":   " 1.0.34 ",
		"Sec-Ch-Ua-Platform": ` "macOS" `,
	}))
	assert.Equal(t, "claude-cli/1.0.34 (external, cli)", client.UserAgent)
	assert.Equal(t, "1.0.34", client.ClientVersion)
	assert.Equal(t, "macOS", client.Platform)

	assert.Equal(t, riskClientIdentity{}, riskClientIdentityFromHeaders(func(string) string { return "" }),
		"missing headers must yield an empty identity")

	oversized := riskClientIdentityFromHeaders(headers(map[string]string{
		"User-Agent": strings.Repeat("a", riskClientUserAgentMaxLen+50),
	}))
	assert.Len(t, oversized.UserAgent, riskClientUserAgentMaxLen)
}

// TestCrossUserEventEvidenceCarriesClientIdentity 端到端验证：同一指纹被三个账号
// 使用后，跨用户事件的证据同时给出客户端标识与关联账号，无需再翻日志对照。
func TestCrossUserEventEvidenceCarriesClientIdentity(t *testing.T) {
	newRiskTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.User{}))
	for _, user := range []model.User{
		{Id: 1, Username: "alice", Status: 1, AffCode: "sim-aff-alice"},
		{Id: 2, Username: "bob", Status: 1, AffCode: "sim-aff-bob"},
		{Id: 3, Username: "carol", Status: 1, AffCode: "sim-aff-carol"},
	} {
		require.NoError(t, model.DB.Create(&user).Error)
	}

	newRiskTestRedis(t)

	headers := func(name string) string {
		switch name {
		case "User-Agent":
			return "claude-cli/1.0.34 (external, cli)"
		case "X-Client-Version":
			return "1.0.34"
		case "Sec-Ch-Ua-Platform":
			return `"macOS"`
		default:
			return ""
		}
	}
	fp := ComputeClientFingerprint(headers, "test-salt")
	require.NotEmpty(t, fp)
	for userId := 1; userId <= 3; userId++ {
		RecordRiskFingerprintDaily(userId, userId, fp, riskClientIdentityFromHeaders(headers))
	}

	scanCrossUserFingerprints(context.Background(), risk_setting.RiskSetting{CrossUserThreshold: 3})

	events, total, err := model.GetTokenRiskEvents(model.TokenRiskEventFilter{}, 0, 10)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Equal(t, risk_setting.RiskEventFpCrossUser, events[0].EventType)

	var evidence struct {
		Fingerprint   string   `json:"fingerprint"`
		UserAgent     string   `json:"user_agent"`
		ClientVersion string   `json:"client_version"`
		Platform      string   `json:"platform"`
		UserIds       []int    `json:"user_ids"`
		Usernames     []string `json:"usernames"`
		UserCount     int      `json:"user_count"`
		Threshold     int      `json:"threshold"`
	}
	require.NoError(t, common.UnmarshalJsonStr(events[0].Evidence, &evidence))
	assert.Equal(t, fp, evidence.Fingerprint)
	assert.Equal(t, "claude-cli/1.0.34 (external, cli)", evidence.UserAgent)
	assert.Equal(t, "1.0.34", evidence.ClientVersion)
	assert.Equal(t, "macOS", evidence.Platform)
	assert.Equal(t, []int{1, 2, 3}, evidence.UserIds)
	assert.Equal(t, []string{"alice", "bob", "carol"}, evidence.Usernames)
	assert.Equal(t, 3, evidence.UserCount)
	assert.Equal(t, 3, evidence.Threshold)
}

// TestConcurrentFpEventEvidenceListsInFlightClients 端到端验证并发指纹事件的证据：
// 除了触发时的指纹数，还给出在途的每个指纹及其客户端标识。
func TestConcurrentFpEventEvidenceListsInFlightClients(t *testing.T) {
	newRiskTestDB(t)
	newRiskTestRedis(t)
	resetRiskTrackerForTest(t)

	clients := []string{
		"claude-cli/1.0.34 (external, cli)",
		"OpenAI/Python 1.58.1",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/153.0.0.0 Safari/537.36",
	}
	const userId, tokenId = 7, 42
	last := ""
	for _, client := range clients {
		// 每个客户端两个在途请求：离开其中一个后三个指纹都仍在途，触发并发指纹信号。
		for range 2 {
			last = EnterRiskInflight(userId, tokenId, riskHeadersClient(client))
			require.NotEmpty(t, last)
		}
	}
	LeaveRiskInflight(userId, tokenId, last)

	events, total, err := model.GetTokenRiskEvents(model.TokenRiskEventFilter{}, 0, 10)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Equal(t, risk_setting.RiskEventConcurrentFp, events[0].EventType)

	var evidence struct {
		ConcurrentFingerprints int64 `json:"concurrent_fingerprints"`
		Threshold              int   `json:"threshold"`
		Fingerprints           []struct {
			Fingerprint string `json:"fingerprint"`
			Requests    int64  `json:"requests"`
			UserAgent   string `json:"user_agent"`
		} `json:"fingerprints"`
	}
	require.NoError(t, common.UnmarshalJsonStr(events[0].Evidence, &evidence))
	assert.Equal(t, int64(3), evidence.ConcurrentFingerprints)
	assert.Equal(t, 3, evidence.Threshold)
	require.Len(t, evidence.Fingerprints, 3)

	observedClients := make([]string, 0, len(evidence.Fingerprints))
	for _, ref := range evidence.Fingerprints {
		assert.NotEmpty(t, ref.Fingerprint)
		assert.Contains(t, clients, ref.UserAgent, "每个在途指纹都要带出客户端标识")
		assert.Positive(t, ref.Requests)
		observedClients = append(observedClients, ref.UserAgent)
	}
	assert.ElementsMatch(t, clients, observedClients, "三个客户端的指纹明细都要出现")
	assert.GreaterOrEqual(t, evidence.Fingerprints[0].Requests, evidence.Fingerprints[2].Requests,
		"指纹明细按在途请求数降序排列")
}

// TestSingleFpEventEvidenceIdentifiesFingerprintClient 端到端验证单指纹并发事件的
// 证据点名了该指纹本身及其客户端软件。
func TestSingleFpEventEvidenceIdentifiesFingerprintClient(t *testing.T) {
	newRiskTestDB(t)
	newRiskTestRedis(t)
	resetRiskTrackerForTest(t)

	const userId, tokenId = 9, 43
	client := "claude-cli/1.0.34 (external, cli)"
	// 结束请求时会先递减在途计数，因此要多发起一次才越过阈值。
	enters := risk_setting.GetSetting().MaxConcurrentRequestsPerFingerprint + 1
	fp := ""
	for range enters {
		fp = EnterRiskInflight(userId, tokenId, riskHeadersClient(client))
		require.NotEmpty(t, fp)
	}
	LeaveRiskInflight(userId, tokenId, fp)

	events, total, err := model.GetTokenRiskEvents(model.TokenRiskEventFilter{}, 0, 10)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Equal(t, risk_setting.RiskEventSingleFpConcurrency, events[0].EventType)

	var evidence struct {
		SingleFpInflight int64  `json:"single_fp_inflight"`
		Threshold        int    `json:"threshold"`
		Fingerprint      string `json:"fingerprint"`
		UserAgent        string `json:"user_agent"`
	}
	require.NoError(t, common.UnmarshalJsonStr(events[0].Evidence, &evidence))
	assert.Equal(t, int64(risk_setting.GetSetting().MaxConcurrentRequestsPerFingerprint), evidence.SingleFpInflight)
	assert.Equal(t, risk_setting.GetSetting().MaxConcurrentRequestsPerFingerprint, evidence.Threshold)
	assert.Equal(t, fp, evidence.Fingerprint, "证据要给出触发阈值的指纹")
	assert.Equal(t, client, evidence.UserAgent, "证据要说明该指纹是什么客户端")
}

// TestFpBurstEventEvidenceListsTopClients 端到端验证日多样性事件的证据：给出当日
// 请求数最多的有效指纹明细（含客户端标识），并按请求数降序截断到上限。
func TestFpBurstEventEvidenceListsTopClients(t *testing.T) {
	newRiskTestDB(t)
	newRiskTestRedis(t)

	const tokenId = 55
	clientCount := riskEvidenceFingerprintLimit + 1
	for i := range clientCount {
		client := fmt.Sprintf("client-%d/1.0", i)
		fingerprint := fmt.Sprintf("fp%014d", i)
		for range i + 1 {
			RecordRiskFingerprintDaily(tokenId, i+1, fingerprint, riskClientIdentityFromHeaders(riskHeadersClient(client)))
		}
	}

	scanDailyFingerprints(context.Background(), time.Now().Format("20060102"), risk_setting.RiskSetting{
		DailyFingerprintThreshold: clientCount - 1,
		MinRequestsPerFingerprint: 1,
	})

	events, total, err := model.GetTokenRiskEvents(model.TokenRiskEventFilter{}, 0, 10)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Equal(t, risk_setting.RiskEventFpBurst, events[0].EventType)

	var evidence struct {
		DistinctFingerprints int64 `json:"distinct_fingerprints"`
		ValidFingerprints    int   `json:"valid_fingerprints"`
		Threshold            int   `json:"threshold"`
		Fingerprints         []struct {
			Fingerprint string `json:"fingerprint"`
			Requests    int64  `json:"requests"`
			UserAgent   string `json:"user_agent"`
		} `json:"fingerprints"`
	}
	require.NoError(t, common.UnmarshalJsonStr(events[0].Evidence, &evidence))
	assert.Equal(t, int64(clientCount), evidence.DistinctFingerprints)
	assert.Equal(t, clientCount, evidence.ValidFingerprints)
	assert.Equal(t, clientCount-1, evidence.Threshold)

	require.Len(t, evidence.Fingerprints, riskEvidenceFingerprintLimit, "证据明细按上限截断")
	requests := make([]int64, 0, len(evidence.Fingerprints))
	for i, ref := range evidence.Fingerprints {
		requests = append(requests, ref.Requests)
		assert.Equal(t, fmt.Sprintf("client-%d/1.0", clientCount-1-i), ref.UserAgent,
			"指纹明细要带出客户端标识并按请求数降序")
	}
	assert.Equal(t, []int64{6, 5, 4, 3, 2}, requests)
	assert.Equal(t, fmt.Sprintf("fp%014d", clientCount-1), evidence.Fingerprints[0].Fingerprint)
}

// TestRecordRiskFingerprintDailyKeyTTLs 验证指纹观测写入的四个键都带过期时间：
// 日维度键覆盖扫描回看窗口，聚类集合覆盖 7 天回看窗口，客户端标识只保留最近活跃的
// 指纹。任何一个键缺少 TTL 都会让 Redis 随指纹/日期无界增长。
func TestRecordRiskFingerprintDailyKeyTTLs(t *testing.T) {
	newRiskTestRedis(t)
	const fingerprint = "0123456789abcdef"
	const tokenId = 21
	RecordRiskFingerprintDaily(tokenId, 7, fingerprint, riskClientIdentity{UserAgent: "claude-cli/1.0.34"})

	ctx := context.Background()
	day := time.Now().Format("20060102")
	ttls := map[string]time.Duration{
		"risk:fpday:" + fmt.Sprintf("%d:%s", tokenId, day):   riskDailyKeyTTL,
		"risk:fpcount:" + fmt.Sprintf("%d:%s", tokenId, day): riskDailyKeyTTL,
		"risk:fpusers:" + fingerprint:                        riskFpUsersKeyTTL,
		"risk:fpclient:" + fingerprint:                       riskFpClientKeyTTL,
	}
	for key, want := range ttls {
		ttl, err := common.RDB.TTL(ctx, key).Result()
		require.NoError(t, err, "key %s must exist", key)
		assert.Equal(t, want, ttl, "key %s must carry its expiry", key)
	}

	// 客户端标识必须短于聚类集合，否则随机 UA 攻击下每个指纹都会长期占用两个键。
	assert.Less(t, riskFpClientKeyTTL, riskFpUsersKeyTTL)
	// 每日扫描回看"昨天"整天且按 24 小时周期执行，标识存活期短于 48 小时会丢标识。
	assert.GreaterOrEqual(t, riskFpClientKeyTTL, 48*time.Hour)
}

// TestTokenRiskUserSummariesKeepCrossUserEvidence 验证聚合列表在最新事件不是
// fp_cross_user 时仍带出该信号的最新证据，跨用户账号不会因为事件新旧被隐藏。
func TestTokenRiskUserSummariesKeepCrossUserEvidence(t *testing.T) {
	newRiskTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.User{}))

	crossUserEvidence := marshalRiskEvidence(riskCrossUserEvidence{
		Fingerprint: "0123456789abcdef",
		UserIds:     []int{7, 12, 305},
		Usernames:   []string{"alice", "bob", "#305"},
		UserCount:   3,
		Threshold:   3,
	})
	model.RecordTokenRiskEventFromSample(7, 21, risk_setting.RiskEventFpCrossUser, crossUserEvidence, time.Now())
	burstEvidence := marshalRiskEvidence(riskFpBurstEvidence{
		DistinctFingerprints: 15,
		ValidFingerprints:    12,
		Threshold:            10,
	})
	model.RecordTokenRiskEventFromSample(7, 21, risk_setting.RiskEventFpBurst, burstEvidence, time.Now())

	items, total, err := model.GetTokenRiskUserSummaries(model.TokenRiskEventFilter{}, 0, 10)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, items, 1)
	assert.Equal(t, int64(2), items[0].EventCount)
	assert.Equal(t, int64(1), items[0].FpBurstCount)
	assert.Equal(t, int64(1), items[0].FpCrossUserCount)
	assert.Equal(t, risk_setting.RiskEventFpBurst, items[0].LatestEventType)

	var crossUserSignal *model.TokenRiskUserSignal
	for i := range items[0].Signals {
		if items[0].Signals[i].EventType == risk_setting.RiskEventFpCrossUser {
			crossUserSignal = &items[0].Signals[i]
		}
	}
	require.NotNil(t, crossUserSignal, "cross-user evidence must survive in the aggregate row")
	assert.Equal(t, crossUserEvidence, crossUserSignal.Evidence)
}

// TestTokenRiskEventMigrateIdempotent 验证重复迁移（AutoMigrate 幂等）与
// 唯一索引存在，防止再次出现普通索引导致 OnConflict 失效的回归。
func TestTokenRiskEventMigrateIdempotent(t *testing.T) {
	newRiskTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.TokenRiskEvent{}))
	require.NoError(t, model.DB.AutoMigrate(&model.TokenRiskEvent{}))

	migrator := model.DB.Migrator()
	assert.True(t, migrator.HasTable(&model.TokenRiskEvent{}))
	for _, column := range []string{"user_id", "token_id", "event_type", "hour_bucket", "evidence", "status", "created_time"} {
		assert.True(t, migrator.HasColumn(&model.TokenRiskEvent{}, column), "column %s must exist", column)
	}
	assert.True(t, migrator.HasIndex(&model.TokenRiskEvent{}, "idx_risk_token_type_hour"),
		"dedup unique index must exist")
}
