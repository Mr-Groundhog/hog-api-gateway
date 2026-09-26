package service

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/glebarez/sqlite"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"

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

// TestRiskCrossUserEvidenceIsValidJSON 验证跨账号指纹证据是合法 JSON 且带出关联账号
// 明细、来源 IP 与客户端标识。历史上证据由 fmt.Sprintf("%q") 拼接切片，元素间缺逗号
// 导致前端 JSON.parse 失败并隐藏证据。
func TestRiskCrossUserEvidenceIsValidJSON(t *testing.T) {
	evidence := marshalRiskEvidence(riskCrossUserEvidence{
		Fingerprint: "0123456789abcdef",
		riskClientIdentity: riskClientIdentity{
			UserAgent:     "claude-cli/1.0.34 (external, cli)",
			ClientVersion: "1.0.34",
			Platform:      "macOS",
		},
		SourceIp: "203.0.113.7",
		Accounts: []riskCrossUserAccount{
			{UserId: 7, Username: "alice", TokenId: 21, Requests: 12, FirstSeen: 1_700_000_000, LastSeen: 1_700_003_600},
			{UserId: 305, Username: "#305", TokenId: 44, Requests: 4, FirstSeen: 1_700_000_100, LastSeen: 1_700_000_200},
		},
		UserCount: 2,
		Threshold: 2,
	})

	var parsed struct {
		Fingerprint   string `json:"fingerprint"`
		UserAgent     string `json:"user_agent"`
		ClientVersion string `json:"client_version"`
		Platform      string `json:"platform"`
		SourceIp      string `json:"source_ip"`
		Accounts      []struct {
			UserId    int    `json:"user_id"`
			Username  string `json:"username"`
			TokenId   int    `json:"token_id"`
			Requests  int64  `json:"requests"`
			FirstSeen int64  `json:"first_seen"`
			LastSeen  int64  `json:"last_seen"`
		} `json:"accounts"`
		UserCount int `json:"user_count"`
		Threshold int `json:"threshold"`
	}
	require.NoError(t, common.UnmarshalJsonStr(evidence, &parsed),
		"cross-user evidence must be valid JSON")
	assert.Equal(t, "0123456789abcdef", parsed.Fingerprint)
	assert.Equal(t, "claude-cli/1.0.34 (external, cli)", parsed.UserAgent,
		"evidence must show which client the fingerprint belongs to")
	assert.Equal(t, "1.0.34", parsed.ClientVersion)
	assert.Equal(t, "macOS", parsed.Platform)
	assert.Equal(t, "203.0.113.7", parsed.SourceIp,
		"evidence must name the shared source address the cluster was built on")
	require.Len(t, parsed.Accounts, 2)
	assert.Equal(t, 7, parsed.Accounts[0].UserId)
	assert.Equal(t, "alice", parsed.Accounts[0].Username)
	assert.Equal(t, 21, parsed.Accounts[0].TokenId)
	assert.Equal(t, int64(12), parsed.Accounts[0].Requests)
	assert.Equal(t, int64(1_700_000_000), parsed.Accounts[0].FirstSeen)
	assert.Equal(t, int64(1_700_003_600), parsed.Accounts[0].LastSeen)
	assert.Equal(t, "#305", parsed.Accounts[1].Username,
		"missing usernames must fall back to #{id}")
	assert.Equal(t, 2, parsed.UserCount)
	assert.Equal(t, 2, parsed.Threshold)

	withoutClient := marshalRiskEvidence(riskCrossUserEvidence{
		Fingerprint: "0123456789abcdef",
		SourceIp:    "203.0.113.7",
		Accounts:    []riskCrossUserAccount{{UserId: 7, Username: "alice", Requests: 1}},
		UserCount:   1,
		Threshold:   1,
	})
	assert.NotContains(t, withoutClient, "user_agent",
		"missing client headers must not produce empty evidence fields")
	assert.NotContains(t, withoutClient, "client_ip",
		"the shared source address is reported once as source_ip, not per account")
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

// TestIpBurstEventFlagsTokenSeenFromManyNetworks 验证"key 被多人共用/售卖"的兜底信号：
// 同一令牌当日来自多个来源网络时触发 ip_burst，IPv6 按 /64 归并成一个网络，请求数
// 低于最小请求数的来源地址不计入（泄漏后被扫描器逐个地址试一次不该算发散）。
func TestIpBurstEventFlagsTokenSeenFromManyNetworks(t *testing.T) {
	newRiskTestDB(t)
	newRiskTestRedis(t)

	const tokenId = 61
	day := time.Date(2026, 9, 25, 8, 0, 0, 0, time.UTC)
	observe := func(ip string, requests int) {
		for range requests {
			RecordRiskFingerprintDaily(riskFingerprintObservation{
				TokenId:     tokenId,
				UserId:      7,
				Fingerprint: "fp-same-client",
				ClientIp:    ip,
			}, day)
		}
	}
	scan := func(threshold, minRequests int) int64 {
		scanDailySourceNetworks(context.Background(), day.Format("20060102"),
			risk_setting.RiskSetting{DailySourceIpThreshold: threshold, MinRequestsPerFingerprint: minRequests})
		_, total, err := model.GetTokenRiskEvents(model.TokenRiskEventFilter{}, 0, 10)
		require.NoError(t, err)
		return total
	}

	// 同一款客户端（指纹相同）从两个网络使用，另一个网络只试过一次：有效来源只有 2 个。
	observe("198.51.100.1", 3)
	observe("203.0.113.7", 3)
	observe("192.0.2.9", 1)
	assert.Zero(t, scan(3, 3), "有效来源网络数不足阈值时不触发")

	// 第三个网络补足请求数后达到阈值。
	observe("192.0.2.9", 2)
	require.Equal(t, int64(1), scan(3, 3), "同一令牌来自多个来源网络必须触发")

	events, _, err := model.GetTokenRiskEvents(model.TokenRiskEventFilter{}, 0, 10)
	require.NoError(t, err)
	require.Equal(t, risk_setting.RiskEventIpBurst, events[0].EventType)
	require.Equal(t, tokenId, events[0].TokenId)

	var evidence struct {
		DistinctSourceNetworks int `json:"distinct_source_networks"`
		ValidSourceNetworks    int `json:"valid_source_networks"`
		Threshold              int `json:"threshold"`
		SourceNetworks         []struct {
			Network  string `json:"network"`
			Requests int64  `json:"requests"`
		} `json:"source_networks"`
	}
	require.NoError(t, common.UnmarshalJsonStr(events[0].Evidence, &evidence))
	assert.Equal(t, 3, evidence.DistinctSourceNetworks)
	assert.Equal(t, 3, evidence.ValidSourceNetworks)
	assert.Equal(t, 3, evidence.Threshold)
	require.Len(t, evidence.SourceNetworks, 3)
	networks := make([]string, 0, len(evidence.SourceNetworks))
	for _, ref := range evidence.SourceNetworks {
		networks = append(networks, ref.Network)
		assert.Equal(t, int64(3), ref.Requests)
	}
	assert.ElementsMatch(t, []string{"198.51.100.1", "203.0.113.7", "192.0.2.9"}, networks)
}

// TestIpBurstGroupsIpv6ByPrefix 验证 IPv6 隐私扩展地址按 /64 归并：同一个 /64 内的多个
// 地址属于同一个来源网络，不因为地址轮换而把单个人的使用算成多个来源。
func TestIpBurstGroupsIpv6ByPrefix(t *testing.T) {
	newRiskTestRedis(t)

	const tokenId = 62
	day := time.Date(2026, 9, 25, 8, 0, 0, 0, time.UTC)
	for _, ip := range []string{"2001:db8:1:2::1", "2001:db8:1:2::2", "2001:db8:1:2:abcd::5"} {
		for range 3 {
			RecordRiskFingerprintDaily(riskFingerprintObservation{
				TokenId:     tokenId,
				UserId:      7,
				Fingerprint: "fp-same-client",
				ClientIp:    ip,
			}, day)
		}
	}
	// 另一个 /64 才是第二个来源网络。
	for range 3 {
		RecordRiskFingerprintDaily(riskFingerprintObservation{
			TokenId:     tokenId,
			UserId:      7,
			Fingerprint: "fp-same-client",
			ClientIp:    "2001:db8:1:3::1",
		}, day)
	}

	networks, err := common.RDB.HKeys(context.Background(),
		fmt.Sprintf("risk:tokenip:%d:%s", tokenId, day.Format("20060102"))).Result()
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"2001:db8:1:2::/64", "2001:db8:1:3::/64"}, networks,
		"同一 /64 下的不同地址必须归并成一个来源网络")
}

// TestCrossUserEventEvidenceCarriesAccountsAndSourceIp 端到端验证：同一指纹、同一
// 来源 IP 下出现三个账号后，跨账号事件的证据给出共用来源 IP、客户端标识，以及每个
// 账号的请求数与首末出现时间，无需再翻日志对照。
func TestCrossUserEventEvidenceCarriesAccountsAndSourceIp(t *testing.T) {
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
	now := time.Now()
	for userId := 1; userId <= 3; userId++ {
		// 每个账号 3 次请求，达到 MinRequestsPerFingerprint；令牌按账号区分。
		for range 3 {
			RecordRiskFingerprintDaily(riskFingerprintObservation{
				TokenId:     100 + userId,
				UserId:      userId,
				Fingerprint: fp,
				ClientIp:    "203.0.113.7",
				Client:      riskClientIdentityFromHeaders(headers),
			}, now)
		}
	}

	scanCrossUserFingerprints(context.Background(), now.Format("20060102"),
		risk_setting.RiskSetting{CrossUserThreshold: 3, MinRequestsPerFingerprint: 3})

	events, total, err := model.GetTokenRiskEvents(model.TokenRiskEventFilter{}, 0, 10)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Equal(t, risk_setting.RiskEventFpCrossUser, events[0].EventType)

	var evidence struct {
		Fingerprint   string `json:"fingerprint"`
		UserAgent     string `json:"user_agent"`
		ClientVersion string `json:"client_version"`
		Platform      string `json:"platform"`
		SourceIp      string `json:"source_ip"`
		Accounts      []struct {
			UserId    int    `json:"user_id"`
			Username  string `json:"username"`
			TokenId   int    `json:"token_id"`
			Requests  int64  `json:"requests"`
			FirstSeen int64  `json:"first_seen"`
			LastSeen  int64  `json:"last_seen"`
		} `json:"accounts"`
		UserCount int `json:"user_count"`
		Threshold int `json:"threshold"`
	}
	require.NoError(t, common.UnmarshalJsonStr(events[0].Evidence, &evidence))
	assert.Equal(t, fp, evidence.Fingerprint)
	assert.Equal(t, "claude-cli/1.0.34 (external, cli)", evidence.UserAgent)
	assert.Equal(t, "1.0.34", evidence.ClientVersion)
	assert.Equal(t, "macOS", evidence.Platform)
	assert.Equal(t, "203.0.113.7", evidence.SourceIp, "证据必须点名账号共用的来源 IP")
	assert.Equal(t, 3, evidence.UserCount)
	assert.Equal(t, 3, evidence.Threshold)

	require.Len(t, evidence.Accounts, 3)
	userIds := make([]int, 0, len(evidence.Accounts))
	usernames := make([]string, 0, len(evidence.Accounts))
	for _, account := range evidence.Accounts {
		userIds = append(userIds, account.UserId)
		usernames = append(usernames, account.Username)
		assert.Equal(t, int64(3), account.Requests)
		assert.Equal(t, account.UserId+100, account.TokenId)
		assert.NotZero(t, account.FirstSeen, "账号明细要给出当日首次出现时间")
		assert.NotZero(t, account.LastSeen, "账号明细要给出当日最近出现时间")
	}
	assert.Equal(t, []int{1, 2, 3}, userIds, "请求数相同时账号明细按用户 ID 稳定排序")
	assert.ElementsMatch(t, []string{"alice", "bob", "carol"}, usernames)
}

// TestCrossUserFingerprintRequiresSameSourceIpOnScannedDay 验证跨账号聚类的两个前提：
// 指纹相同但来源 IP 不同不算关联（同一公共客户端被不同网络的人使用是常态，不构成分发），
// 且只统计扫描当天记录的数据，历史观测不会作为陈旧成员反复出现在关联名单里。
func TestCrossUserFingerprintRequiresSameSourceIpOnScannedDay(t *testing.T) {
	newRiskTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.User{}))
	newRiskTestRedis(t)

	const fp = "0123456789abcdef"
	scanDay := time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC)
	observation := func(userId int, ip string) riskFingerprintObservation {
		return riskFingerprintObservation{
			TokenId:     100 + userId,
			UserId:      userId,
			Fingerprint: fp,
			ClientIp:    ip,
		}
	}
	scan := func() int64 {
		scanCrossUserFingerprints(context.Background(), scanDay.Format("20060102"),
			risk_setting.RiskSetting{CrossUserThreshold: 3, MinRequestsPerFingerprint: 1})
		_, total, err := model.GetTokenRiskEvents(model.TokenRiskEventFilter{}, 0, 10)
		require.NoError(t, err)
		return total
	}

	// 三个账号同一指纹、三个不同来源：不构成关联。
	for userId := 1; userId <= 3; userId++ {
		RecordRiskFingerprintDaily(observation(userId, fmt.Sprintf("198.51.100.%d", userId)), scanDay)
	}
	assert.Zero(t, scan(), "同一客户端软件在不同来源 IP 上出现不是跨账号关联")

	// 三个账号同一指纹、同一来源，但发生在扫描日之前：不进入本次扫描。
	previousDay := scanDay.AddDate(0, 0, -1)
	for userId := 1; userId <= 3; userId++ {
		RecordRiskFingerprintDaily(observation(userId, "203.0.113.7"), previousDay)
	}
	assert.Zero(t, scan(), "只统计扫描当天真实出现过的账号，历史观测不会留在名单里")

	// 同一来源 IP 下的同指纹三账号：命中。
	for userId := 1; userId <= 3; userId++ {
		RecordRiskFingerprintDaily(observation(userId, "203.0.113.7"), scanDay)
	}
	assert.Equal(t, int64(1), scan(), "同一来源 IP 下的同指纹多账号必须命中")
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
			last = EnterRiskInflight(userId, tokenId, riskHeadersClient(client), "203.0.113.7")
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
		fp = EnterRiskInflight(userId, tokenId, riskHeadersClient(client), "203.0.113.7")
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
			RecordRiskFingerprintDaily(riskFingerprintObservation{
				TokenId:     tokenId,
				UserId:      i + 1,
				Fingerprint: fingerprint,
				ClientIp:    "203.0.113.7",
				Client:      riskClientIdentityFromHeaders(riskHeadersClient(client)),
			}, time.Now())
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
// 日维度键覆盖扫描回看窗口，聚类明细覆盖当天及其余量，客户端标识只保留最近活跃的
// 指纹。任何一个键缺少 TTL 都会让 Redis 随指纹/日期无界增长。
func TestRecordRiskFingerprintDailyKeyTTLs(t *testing.T) {
	newRiskTestRedis(t)
	const fingerprint = "0123456789abcdef"
	const tokenId = 21
	RecordRiskFingerprintDaily(riskFingerprintObservation{
		TokenId:     tokenId,
		UserId:      7,
		Fingerprint: fingerprint,
		ClientIp:    "203.0.113.7",
		Client:      riskClientIdentity{UserAgent: "claude-cli/1.0.34"},
	}, time.Now())

	ctx := context.Background()
	day := time.Now().Format("20060102")
	ttls := map[string]time.Duration{
		"risk:fpday:" + fmt.Sprintf("%d:%s", tokenId, day):   riskDailyKeyTTL,
		"risk:fpcount:" + fmt.Sprintf("%d:%s", tokenId, day): riskDailyKeyTTL,
		"risk:fpnet:" + fingerprint + ":" + day:              riskFpNetKeyTTL,
		"risk:fpclient:" + fingerprint:                       riskFpClientKeyTTL,
	}
	for key, want := range ttls {
		ttl, err := common.RDB.TTL(ctx, key).Result()
		require.NoError(t, err, "key %s must exist", key)
		assert.Equal(t, want, ttl, "key %s must carry its expiry", key)
	}

	// 客户端标识必须短于聚类明细，否则随机 UA 攻击下每个指纹都会长期占用两个键。
	assert.Less(t, riskFpClientKeyTTL, riskFpNetKeyTTL)
	// 每日扫描回看"昨天"整天且按 24 小时周期执行，标识存活期短于 48 小时会丢标识。
	assert.GreaterOrEqual(t, riskFpClientKeyTTL, 48*time.Hour)
	// 聚类明细同样要覆盖"昨天"的数据，直到次日扫描把它读完。
	assert.GreaterOrEqual(t, riskFpNetKeyTTL, 48*time.Hour)
}

// TestTokenRiskUserSummariesKeepCrossUserEvidence 验证聚合列表在最新事件不是
// fp_cross_user 时仍带出该信号的最新证据，跨用户账号不会因为事件新旧被隐藏。
func TestTokenRiskUserSummariesKeepCrossUserEvidence(t *testing.T) {
	newRiskTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.User{}))

	crossUserEvidence := marshalRiskEvidence(riskCrossUserEvidence{
		Fingerprint: "0123456789abcdef",
		SourceIp:    "203.0.113.7",
		Accounts: []riskCrossUserAccount{
			{UserId: 7, Username: "alice", TokenId: 21, Requests: 9},
			{UserId: 12, Username: "bob", TokenId: 31, Requests: 4},
			{UserId: 305, Username: "#305", TokenId: 32, Requests: 3},
		},
		UserCount: 3,
		Threshold: 3,
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

// TestTokenRiskUserSummariesDatabaseMatrix 在 SQLite / MySQL / PostgreSQL 上验证按用户
// 聚合查询：各信号的计数列由 SUM(CASE WHEN event_type = ...) 得出，新增的 ip_burst 列
// 与既有列共用同一套表达式，必须三种数据库都成立。未配置 TEST_MYSQL_DSN /
// TEST_POSTGRES_DSN 时跳过对应方言。
func TestTokenRiskUserSummariesDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(t.TempDir() + "/risk_summary.db")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{
				NamingStrategy: schema.NamingStrategy{TablePrefix: "risk_summary_test_"},
			})
			require.NoError(t, err)
			previousDB, previousType := model.DB, common.MainDatabaseType()
			model.DB = db
			common.SetMainDatabaseType(common.DatabaseType(dialect))
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&model.TokenRiskEvent{}))
				if sqlDB, err := db.DB(); err == nil {
					_ = sqlDB.Close()
				}
				model.DB = previousDB
				common.SetMainDatabaseType(previousType)
			})
			require.NoError(t, db.AutoMigrate(&model.TokenRiskEvent{}))

			now := time.Now()
			eventTypes := []string{
				risk_setting.RiskEventConcurrentFp,
				risk_setting.RiskEventSingleFpConcurrency,
				risk_setting.RiskEventFpBurst,
				risk_setting.RiskEventIpBurst,
				risk_setting.RiskEventIpBurst,
				risk_setting.RiskEventFpCrossUser,
			}
			for _, eventType := range eventTypes {
				// 每个事件落在不同小时桶，唯一索引不会把它们合并成一行。
				model.RecordTokenRiskEventFromSample(7, 21, eventType, "{}", now)
				now = now.Add(time.Hour)
			}

			items, total, err := model.GetTokenRiskUserSummaries(model.TokenRiskEventFilter{}, 0, 10)
			require.NoError(t, err)
			require.Equal(t, int64(1), total)
			require.Len(t, items, 1)
			assert.Equal(t, int64(len(eventTypes)), items[0].EventCount)
			assert.Equal(t, int64(1), items[0].ConcurrentFpCount)
			assert.Equal(t, int64(1), items[0].SingleFpCount)
			assert.Equal(t, int64(1), items[0].FpBurstCount)
			assert.Equal(t, int64(2), items[0].IpBurstCount, "同类型多行必须累加到 ip_burst 计数")
			assert.Equal(t, int64(1), items[0].FpCrossUserCount)
			assert.Equal(t, int64(1), items[0].InvolvedTokenCount)
			assert.Equal(t, int64(len(eventTypes)), items[0].PendingCount)
		})
	}
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
