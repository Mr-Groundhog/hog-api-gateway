package service

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/risk_setting"
)

// 日多样性与跨用户聚类的 Redis 结构（TTL 兜底自动过期，数据丢失静默降级）：
//
//	risk:fpday:{token_id}:{yyyyMMdd}    HyperLogLog，PFADD 指纹 → 当日 distinct 指纹数（8 天）
//	risk:fpcount:{token_id}:{yyyyMMdd}  Hash，field=指纹 value=请求数 → 过滤一次性指纹（8 天）
//	risk:fpusers:{fp}                   Set，member=user_id → 指纹跨用户聚类（7 天）
//	risk:fpclient:{fp}                  客户端标识 JSON（UA/版本/平台）→ 证据佐证客户端（48 小时）
//
// fpusers / fpclient 按指纹维度建键：每出现一个新指纹就多一组键，是随机 UA 攻击下
// Redis 键数量增长的主要来源，因此客户端标识的存活期远短于聚类集合，只保留最近
// 活跃指纹的标识。
const (
	riskDailyKeyTTL = 8 * 24 * time.Hour
	// riskFpUsersKeyTTL 是跨用户聚类集合的存活期，等于扫描回看窗口。
	riskFpUsersKeyTTL = 7 * 24 * time.Hour
	// riskFpClientKeyTTL 是客户端标识的存活期。每日扫描回看"昨天"整天、任务按
	// 24 小时周期执行（相位不定），最老的活动距扫描时刻可达约 47 小时，所以 48 小时
	// 是保证日多样性证据不丢标识的下限；对 48 小时前才活跃过的残留指纹，证据里只剩
	// 指纹与计数（无 UA）。
	riskFpClientKeyTTL = 48 * time.Hour
)

// RecordRiskFingerprintDaily 登记一次指纹观测，供每日任务聚合。client 是该指纹
// 对应的客户端标识（同一指纹的请求头固定，因此重复写入的值恒定）。Redis 不可用
// 时静默跳过（聚类信号缺失不阻塞主流程）。调用方需保证 fp 非空且已过滤白名单。
func RecordRiskFingerprintDaily(tokenId, userId int, fp string, client riskClientIdentity) {
	if !common.RedisEnabled || common.RDB == nil || fp == "" || tokenId <= 0 {
		return
	}
	now := time.Now()
	day := now.Format("20060102")
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	fpDayKey := fmt.Sprintf("risk:fpday:%d:%s", tokenId, day)
	fpCountKey := fmt.Sprintf("risk:fpcount:%d:%s", tokenId, day)
	pipe := common.RDB.TxPipeline()
	pipe.PFAdd(ctx, fpDayKey, fp)
	pipe.Expire(ctx, fpDayKey, riskDailyKeyTTL)
	pipe.HIncrBy(ctx, fpCountKey, fp, 1)
	pipe.Expire(ctx, fpCountKey, riskDailyKeyTTL)
	usersKey := fmt.Sprintf("risk:fpusers:%s", fp)
	pipe.SAdd(ctx, usersKey, userId)
	pipe.Expire(ctx, usersKey, riskFpUsersKeyTTL)
	if clientJSON, err := common.Marshal(client); err != nil {
		common.SysError("risk client identity marshal failed: " + err.Error())
	} else {
		clientKey := fmt.Sprintf("risk:fpclient:%s", fp)
		pipe.Set(ctx, clientKey, clientJSON, riskFpClientKeyTTL)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		common.SysError("risk fingerprint daily record failed: " + err.Error())
	}
}

// RunRiskDailyScan 扫描前一天的日多样性数据与跨用户聚类数据，产出 fp_burst /
// fp_cross_user 风控事件。作为每日系统任务执行（DB 租约保证多实例单跑）。
func RunRiskDailyScan() {
	if !common.RedisEnabled || common.RDB == nil {
		return
	}
	setting := risk_setting.GetSetting()
	if !setting.Enabled {
		return
	}
	yesterday := time.Now().AddDate(0, 0, -1).Format("20060102")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	if setting.DailyFingerprintThreshold > 0 {
		scanDailyFingerprints(ctx, yesterday, setting)
	}
	if setting.CrossUserThreshold > 0 {
		scanCrossUserFingerprints(ctx, setting)
	}
}

// scanDailyFingerprints 遍昨日 risk:fpday:*，对 distinct 指纹数超阈值的令牌
// 进一步要求"有效指纹"（请求数 >= MinRequestsPerFingerprint）也超阈值，
// 过滤随机 UA 制造的一次性指纹。
func scanDailyFingerprints(ctx context.Context, day string, setting risk_setting.RiskSetting) {
	var cursor uint64
	for {
		keys, next, err := common.RDB.Scan(ctx, cursor, "risk:fpday:*:"+day, 100).Result()
		if err != nil {
			common.SysError("risk daily scan failed: " + err.Error())
			return
		}
		for _, key := range keys {
			tokenId, ok := tokenIdFromRiskKey(key, "risk:fpday:")
			if !ok || risk_setting.IsTrustedToken(tokenId) {
				continue
			}
			distinct, err := common.RDB.PFCount(ctx, key).Result()
			if err != nil || distinct < int64(setting.DailyFingerprintThreshold) {
				continue
			}
			counts, err := common.RDB.HGetAll(ctx, fmt.Sprintf("risk:fpcount:%d:%s", tokenId, day)).Result()
			if err != nil {
				continue
			}
			// 只有请求数达到 MinRequestsPerFingerprint 的指纹才算有效，
			// 过滤随机 UA 制造的一次性指纹；明细随证据给出，说明请求来自哪些客户端。
			refs := make([]riskFingerprintRef, 0, len(counts))
			for fingerprint, raw := range counts {
				count, err := strconv.ParseInt(raw, 10, 64)
				if err != nil || count < int64(setting.MinRequestsPerFingerprint) {
					continue
				}
				refs = append(refs, riskFingerprintRef{Fingerprint: fingerprint, Requests: count})
			}
			if len(refs) < setting.DailyFingerprintThreshold {
				continue
			}
			userId := riskTokenUserId(tokenId)
			evidence := marshalRiskEvidence(riskFpBurstEvidence{
				DistinctFingerprints: distinct,
				ValidFingerprints:    len(refs),
				Threshold:            setting.DailyFingerprintThreshold,
				Fingerprints:         buildRiskFingerprintRefs(ctx, refs),
			})
			model.RecordTokenRiskEventFromSample(userId, tokenId, risk_setting.RiskEventFpBurst, evidence, time.Now())
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
}

// scanCrossUserFingerprints 遍 risk:fpusers:*，对关联不同用户数超阈值的指纹
// 记录 fp_cross_user 事件（事件归属为指纹下请求数最多的令牌所属用户）。
func scanCrossUserFingerprints(ctx context.Context, setting risk_setting.RiskSetting) {
	var cursor uint64
	for {
		keys, next, err := common.RDB.Scan(ctx, cursor, "risk:fpusers:*", 100).Result()
		if err != nil {
			common.SysError("risk cross-user scan failed: " + err.Error())
			return
		}
		for _, key := range keys {
			fp := strings.TrimPrefix(key, "risk:fpusers:")
			if fp == "" {
				continue
			}
			members, err := common.RDB.SMembers(ctx, key).Result()
			if err != nil {
				continue
			}
			// 集合成员是用户 ID 字符串；先剔除无法解析的成员再和阈值比较，
			// 避免脏成员把关联用户数抬高。
			userIds := make([]int, 0, len(members))
			for _, member := range members {
				if id, err := strconv.Atoi(member); err == nil && id > 0 {
					userIds = append(userIds, id)
				}
			}
			if len(userIds) < setting.CrossUserThreshold {
				continue
			}
			slices.Sort(userIds)
			recordCrossUserEvent(ctx, fp, userIds, setting)
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
}

// recordCrossUserEvent 将跨用户指纹事件记到该指纹下请求数最多的令牌上，
// 证据中列出该指纹对应的客户端标识（UA/版本/平台）与关联的全部账号，
// 便于管理员核对是什么客户端在哪些账号上共用。
// risk:fpcount 只按 (token, day) 维度记录，找"最多请求"的令牌需要回查近 8 天
// 的 fpcount key，量级可控（每指纹每天每令牌一行）。
func recordCrossUserEvent(ctx context.Context, fp string, userIds []int, setting risk_setting.RiskSetting) {
	bestTokenId, bestCount := 0, int64(0)
	var cursor uint64
	for {
		keys, next, err := common.RDB.Scan(ctx, cursor, "risk:fpcount:*", 100).Result()
		if err != nil {
			return
		}
		for _, key := range keys {
			tokenId, ok := tokenIdFromRiskKey(key, "risk:fpcount:")
			if !ok {
				continue
			}
			raw, err := common.RDB.HGet(ctx, key, fp).Result()
			if err != nil {
				continue
			}
			if n, err := strconv.ParseInt(raw, 10, 64); err == nil && n > bestCount {
				bestTokenId, bestCount = tokenId, n
			}
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	userId := 0
	if bestTokenId > 0 {
		if risk_setting.IsTrustedToken(bestTokenId) {
			return
		}
		userId = riskTokenUserId(bestTokenId)
	}
	usernameById := model.GetUsernamesByIds(userIds)
	usernames := make([]string, 0, len(userIds))
	for _, id := range userIds {
		if username := usernameById[id]; username != "" {
			usernames = append(usernames, username)
			continue
		}
		usernames = append(usernames, "#"+strconv.Itoa(id))
	}
	// 客户端标识由请求时随指纹写入，存活期短于聚类集合：指纹在 48 小时内活跃过才有
	// 标识，否则证据只保留指纹与账号（跨用户聚类集合本身可回看 7 天）。
	client := readRiskClientIdentities(ctx, []string{fp})[fp]
	evidence := marshalRiskEvidence(riskCrossUserEvidence{
		Fingerprint:        fp,
		riskClientIdentity: client,
		UserIds:            userIds,
		Usernames:          usernames,
		UserCount:          len(userIds),
		Threshold:          setting.CrossUserThreshold,
	})
	model.RecordTokenRiskEventFromSample(userId, bestTokenId, risk_setting.RiskEventFpCrossUser, evidence, time.Now())
}

// tokenIdFromRiskKey 从形如 risk:{prefix}{token_id}:{day} 的 key 解析 token_id。
// prefix 之后的第一个冒号前的段是 token_id；末尾的日期段由调用方剪除。
func tokenIdFromRiskKey(key, prefix string) (int, bool) {
	rest, _, found := strings.Cut(strings.TrimPrefix(key, prefix), ":")
	if !found {
		return 0, false
	}
	tokenId, err := strconv.Atoi(rest)
	if err != nil || tokenId <= 0 {
		return 0, false
	}
	return tokenId, true
}

// riskTokenUserId 查询令牌所属用户 ID，令牌不存在时返回 0。
func riskTokenUserId(tokenId int) int {
	token, err := model.GetTokenById(tokenId)
	if err != nil || token == nil {
		return 0
	}
	return token.UserId
}
