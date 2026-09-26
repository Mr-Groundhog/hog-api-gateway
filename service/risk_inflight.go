package service

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/risk_setting"
)

// riskInflightTTL 是 in-flight 计数 key 的兜底存活期。正常请求的结束回调会递减
// 计数；panic / 进程重启 / 网络中断丢失的递减最多存活该时长后自动清理，
// 不会造成永久"并发"假象。活跃令牌的 key 因每次访问续期不受影响。
const riskInflightTTL = time.Hour

// riskClientUserAgentMaxLen 是写入证据的 User-Agent 最大长度。异常客户端可能
// 上报超长 UA，截断避免证据与 Redis 值被撑大。
const riskClientUserAgentMaxLen = 256

// fingerprintHeaders 参与客户端指纹计算的请求头。代理/节点转发不会改写这些头，
// 换 IP 对指纹无影响。
var fingerprintHeaders = []string{
	"User-Agent",
	"Accept",
	"Accept-Language",
	"Accept-Encoding",
	"Sec-Ch-Ua",
	"Sec-Ch-Ua-Platform",
	"X-Client-Version",
}

// riskClientIdentityFromHeaders 提取与指纹同源的客户端标识，用于跨用户事件证据。
// User-Agent 超长时截断，Sec-Ch-Ua-Platform 去掉了规范要求的引号。
func riskClientIdentityFromHeaders(getHeader func(string) string) riskClientIdentity {
	userAgent := strings.TrimSpace(getHeader("User-Agent"))
	if len(userAgent) > riskClientUserAgentMaxLen {
		userAgent = userAgent[:riskClientUserAgentMaxLen]
	}
	return riskClientIdentity{
		UserAgent:     userAgent,
		ClientVersion: strings.TrimSpace(getHeader("X-Client-Version")),
		Platform:      strings.Trim(strings.TrimSpace(getHeader("Sec-Ch-Ua-Platform")), `"`),
	}
}

// ComputeClientFingerprint 基于客户端请求头与 HMAC 盐计算 16 位十六进制指纹。
// getHeader 由调用方提供（gin 的 c.GetHeader）；盐为空时返回空串。
func ComputeClientFingerprint(getHeader func(string) string, salt string) string {
	if salt == "" {
		return ""
	}
	var b strings.Builder
	for _, name := range fingerprintHeaders {
		value := strings.TrimSpace(getHeader(name))
		if value == "" {
			value = "\x00"
		}
		b.WriteString(value)
		b.WriteByte('\x1f')
	}
	mac := hmac.New(sha256.New, []byte(salt))
	mac.Write([]byte(b.String()))
	return hex.EncodeToString(mac.Sum(nil))[:16]
}

// EnsureFingerprintSalt 返回指纹盐；为空时生成随机盐并经 model.UpdateOption
// 持久化（key: risk_setting.fingerprint_salt）。失败时返回空串并记日志，
// 本次请求跳过风控，下次重试生成。
func EnsureFingerprintSalt() string {
	setting := risk_setting.GetSetting()
	if setting.FingerprintSalt != "" {
		return setting.FingerprintSalt
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		common.SysError("failed to generate risk fingerprint salt: " + err.Error())
		return ""
	}
	salt := hex.EncodeToString(buf)
	if err := model.UpdateOption("risk_setting.fingerprint_salt", salt); err != nil {
		common.SysError("failed to persist risk fingerprint salt: " + err.Error())
		return ""
	}
	risk_setting.SetFingerprintSalt(salt)
	return salt
}

// riskInflightEvent 描述一次在途计数结束后产生的风控观察结果。
type riskInflightEvent struct {
	EventType string
	// Observed 是触发时的观测值：并发指纹信号下为在途的不同指纹数，
	// 单指纹并发信号下为该指纹的在途请求数。
	Observed int64
	// Threshold 是触发时使用的配置阈值。
	Threshold int
	// Fingerprints 是触发时在途的指纹明细（含各自在途请求数），作为事件证据。
	Fingerprints []riskFingerprintRef
}

// riskInflightTracker 维护每令牌按指纹分桶的在途请求计数。
// Redis 可用时为集群共享实现，否则退化为进程内实现（单实例语义）。
type riskInflightTracker interface {
	// Enter 登记一次在途请求并返回加 1 后该指纹的在途数。
	Enter(tokenId int, fp string) int64
	// Leave 递减一次在途请求并返回观察到的风控事件（并发指纹数/单指纹并发数超阈值），无事件返回空。
	Leave(tokenId int, fp string) *riskInflightEvent
}

// EnterRiskInflight 计算指纹、登记在途并返回指纹。返回空 fp 表示本次请求
// 不参与风控（功能关闭、白名单、盐缺失）。clientIp 是本次请求的来源 IP，
// 与指纹一起登记，供跨账号聚类判定"同一来源"。
func EnterRiskInflight(userId, tokenId int, getHeader func(string) string, clientIp string) string {
	setting := risk_setting.GetSetting()
	if !setting.Enabled || tokenId <= 0 || risk_setting.IsTrustedToken(tokenId) {
		return ""
	}
	salt := EnsureFingerprintSalt()
	if salt == "" {
		return ""
	}
	fp := ComputeClientFingerprint(getHeader, salt)
	riskTracker().Enter(tokenId, fp)
	RecordRiskFingerprintDaily(riskFingerprintObservation{
		TokenId:     tokenId,
		UserId:      userId,
		Fingerprint: fp,
		ClientIp:    clientIp,
		Client:      riskClientIdentityFromHeaders(getHeader),
	}, time.Now())
	return fp
}

// LeaveRiskInflight 结束一次在途计数并按阈值产出事件，证据中列出在途指纹明细
// 及各自的客户端标识（无 Redis 时标识缺失，只留指纹与在途数）。
func LeaveRiskInflight(userId, tokenId int, fp string) {
	if fp == "" || tokenId <= 0 {
		return
	}
	event := riskTracker().Leave(tokenId, fp)
	if event == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	event.Fingerprints = buildRiskFingerprintRefs(ctx, event.Fingerprints)

	var evidence string
	if event.EventType == risk_setting.RiskEventSingleFpConcurrency {
		var triggered riskFingerprintRef
		if len(event.Fingerprints) > 0 {
			triggered = event.Fingerprints[0]
		}
		evidence = marshalRiskEvidence(riskSingleFpEvidence{
			SingleFpInflight:   event.Observed,
			Threshold:          event.Threshold,
			Fingerprint:        triggered.Fingerprint,
			riskClientIdentity: triggered.riskClientIdentity,
		})
	} else {
		evidence = marshalRiskEvidence(riskConcurrentFpEvidence{
			ConcurrentFingerprints: event.Observed,
			Threshold:              event.Threshold,
			Fingerprints:           event.Fingerprints,
		})
	}
	model.RecordTokenRiskEventFromSample(userId, tokenId, event.EventType, evidence, time.Now())
}

var (
	riskTrackerOnce sync.Once
	riskTrackerImpl riskInflightTracker
)

func riskTracker() riskInflightTracker {
	riskTrackerOnce.Do(func() {
		if common.RedisEnabled {
			riskTrackerImpl = &redisRiskInflightTracker{}
		} else {
			riskTrackerImpl = &memoryRiskInflightTracker{}
		}
	})
	return riskTrackerImpl
}

// redisRiskInflightTracker 用 Redis Hash 实现：key = risk:inflight:{token_id}，
// field = 指纹，value = 该指纹在途请求数。TTL 作为丢失递减的自愈兜底。
type redisRiskInflightTracker struct{}

func (t *redisRiskInflightTracker) Enter(tokenId int, fp string) int64 {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	key := fmt.Sprintf("risk:inflight:%d", tokenId)
	pipe := common.RDB.TxPipeline()
	incr := pipe.HIncrBy(ctx, key, fp, 1)
	pipe.Expire(ctx, key, riskInflightTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		common.SysError("risk inflight enter failed: " + err.Error())
		return 0
	}
	return incr.Val()
}

func (t *redisRiskInflightTracker) Leave(tokenId int, fp string) *riskInflightEvent {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	key := fmt.Sprintf("risk:inflight:%d", tokenId)
	decr := common.RDB.HIncrBy(ctx, key, fp, -1)
	if decr.Err() != nil {
		common.SysError("risk inflight leave failed: " + decr.Err().Error())
		return nil
	}
	if decr.Val() <= 0 {
		common.RDB.HDel(ctx, key, fp)
	}
	setting := risk_setting.GetSetting()
	length, err := common.RDB.HLen(ctx, key).Result()
	if err != nil {
		return nil
	}
	if setting.MaxConcurrentFingerprints > 0 && length >= int64(setting.MaxConcurrentFingerprints) {
		// 在途指纹明细作为证据，说明是哪些客户端同时在用这个令牌。
		counts, err := common.RDB.HGetAll(ctx, key).Result()
		if err != nil {
			counts = nil
		}
		refs := make([]riskFingerprintRef, 0, len(counts))
		for fingerprint, raw := range counts {
			count, parseErr := strconv.ParseInt(raw, 10, 64)
			if parseErr != nil || count <= 0 {
				continue
			}
			refs = append(refs, riskFingerprintRef{Fingerprint: fingerprint, Requests: count})
		}
		return &riskInflightEvent{
			EventType:    risk_setting.RiskEventConcurrentFp,
			Observed:     length,
			Threshold:    setting.MaxConcurrentFingerprints,
			Fingerprints: refs,
		}
	}
	if setting.MaxConcurrentRequestsPerFingerprint > 0 {
		remaining, err := common.RDB.HGet(ctx, key, fp).Result()
		if err == nil && remaining != "" {
			var count int64
			if _, err := fmt.Sscanf(remaining, "%d", &count); err == nil &&
				count >= int64(setting.MaxConcurrentRequestsPerFingerprint) {
				return &riskInflightEvent{
					EventType:    risk_setting.RiskEventSingleFpConcurrency,
					Observed:     count,
					Threshold:    setting.MaxConcurrentRequestsPerFingerprint,
					Fingerprints: []riskFingerprintRef{{Fingerprint: fp, Requests: count}},
				}
			}
		}
	}
	return nil
}

// memoryRiskInflightTracker 是无 Redis 时的进程内实现，结构与 Redis 版一一对应。
type memoryRiskInflightTracker struct {
	mutex sync.Mutex
	// tokens 映射 token_id -> 指纹 -> 在途数。
	tokens map[int]map[string]int
	// expireAt 记录每个 token 计数桶的兜底过期时间，对齐 Redis TTL 自愈语义。
	expireAt map[int]time.Time
}

func (t *memoryRiskInflightTracker) Enter(tokenId int, fp string) int64 {
	t.mutex.Lock()
	defer t.mutex.Unlock()
	now := time.Now()
	if t.tokens == nil {
		t.tokens = make(map[int]map[string]int)
		t.expireAt = make(map[int]time.Time)
	}
	if expiry, ok := t.expireAt[tokenId]; ok && now.After(expiry) {
		delete(t.tokens, tokenId)
	}
	t.expireAt[tokenId] = now.Add(riskInflightTTL)
	if t.tokens[tokenId] == nil {
		t.tokens[tokenId] = make(map[string]int)
	}
	t.tokens[tokenId][fp]++
	return int64(t.tokens[tokenId][fp])
}

func (t *memoryRiskInflightTracker) Leave(tokenId int, fp string) *riskInflightEvent {
	t.mutex.Lock()
	defer t.mutex.Unlock()
	bucket := t.tokens[tokenId]
	if bucket == nil {
		return nil
	}
	if bucket[fp] > 0 {
		bucket[fp]--
	}
	if bucket[fp] <= 0 {
		delete(bucket, fp)
	}
	setting := risk_setting.GetSetting()
	if setting.MaxConcurrentFingerprints > 0 && int64(len(bucket)) >= int64(setting.MaxConcurrentFingerprints) {
		refs := make([]riskFingerprintRef, 0, len(bucket))
		for fingerprint, count := range bucket {
			refs = append(refs, riskFingerprintRef{Fingerprint: fingerprint, Requests: int64(count)})
		}
		return &riskInflightEvent{
			EventType:    risk_setting.RiskEventConcurrentFp,
			Observed:     int64(len(bucket)),
			Threshold:    setting.MaxConcurrentFingerprints,
			Fingerprints: refs,
		}
	}
	if setting.MaxConcurrentRequestsPerFingerprint > 0 &&
		int64(bucket[fp]) >= int64(setting.MaxConcurrentRequestsPerFingerprint) {
		return &riskInflightEvent{
			EventType:    risk_setting.RiskEventSingleFpConcurrency,
			Observed:     int64(bucket[fp]),
			Threshold:    setting.MaxConcurrentRequestsPerFingerprint,
			Fingerprints: []riskFingerprintRef{{Fingerprint: fp, Requests: int64(bucket[fp])}},
		}
	}
	return nil
}
