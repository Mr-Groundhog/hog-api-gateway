package service

import (
	"context"
	"fmt"
	"net/netip"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/risk_setting"
)

// 日多样性与跨账号聚类的 Redis 结构（TTL 兜底自动过期，数据丢失静默降级）：
//
//	risk:fpday:{token_id}:{yyyyMMdd}    HyperLogLog，PFADD 指纹 → 当日 distinct 指纹数（8 天）
//	risk:fpcount:{token_id}:{yyyyMMdd}  Hash，field=指纹 value=请求数 → 过滤一次性指纹（8 天）
//	risk:tokenip:{token_id}:{yyyyMMdd}  Hash，field=来源网络 value=请求数 → 当日不同来源网络数（8 天）
//	risk:fpnet:{fp}:{yyyyMMdd}          Hash，field=u{user_id}:{属性} → 当日该指纹下各账号的
//	                                    请求数/来源 IP/首末出现时间/令牌 → 跨账号聚类（3 天）
//	risk:fpclient:{fp}                  客户端标识 JSON（UA/版本/平台）→ 证据佐证客户端（48 小时）
//
// fpnet / fpclient 按指纹维度建键：每出现一个新指纹就多一组键，是随机 UA 攻击下 Redis
// 键数量增长的主要来源，因此客户端标识与聚类明细的存活期都远短于按令牌/日期分键的统计
// （令牌数由业务规模决定，不随攻击者的取值空间增长）。
const (
	riskDailyKeyTTL = 8 * 24 * time.Hour
	// riskFpNetKeyTTL 是跨账号聚类明细的存活期。明细按天分键、按账号分字段，扫描只统计
	// 当天真实出现过的账号，因此不存在"只请求过一次的账号长期挂在关联名单里"的陈旧成员。
	// 每日扫描回看"昨天"整天、任务按 24 小时周期执行（相位不定），最老数据距扫描时刻可达
	// 约 47 小时，48 小时是下限；72 小时给任务延迟与补跑留出余量。
	riskFpNetKeyTTL = 72 * time.Hour
	// riskFpClientKeyTTL 是客户端标识的存活期。每日扫描回看"昨天"整天、任务按
	// 24 小时周期执行（相位不定），最老的活动距扫描时刻可达约 47 小时，所以 48 小时
	// 是保证日多样性证据不丢标识的下限；对 48 小时前才活跃过的残留指纹，证据里只剩
	// 指纹与计数（无 UA）。
	riskFpClientKeyTTL = 48 * time.Hour
)

// riskFingerprintObservation 是一次指纹观测的登记内容：令牌、账号、指纹、来源网络与
// 客户端标识。跨账号聚类按 (指纹, 来源 IP) 判定，因此来源 IP 与指纹同源写入。
type riskFingerprintObservation struct {
	// TokenId 是发起请求的令牌 ID，日多样性统计按它分键。
	TokenId int
	// UserId 是令牌所属用户 ID，作为跨账号聚类的账号维度；为 0 时只写令牌维度数据。
	UserId int
	// Fingerprint 是客户端指纹（16 位十六进制），调用方保证非空且已过滤白名单。
	Fingerprint string
	// ClientIp 是本次请求的客户端 IP，按来源网络归一化后参与聚类与来源数统计。
	ClientIp string
	// Client 是与指纹同源的客户端标识，写入证据供管理员识别客户端软件。
	Client riskClientIdentity
}

// RecordRiskFingerprintDaily 登记一次指纹观测，供每日任务聚合。Redis 不可用
// 时静默跳过（聚类信号缺失不阻塞主流程）。
func RecordRiskFingerprintDaily(obs riskFingerprintObservation, now time.Time) {
	if !common.RedisEnabled || common.RDB == nil || obs.Fingerprint == "" || obs.TokenId <= 0 {
		return
	}
	day := now.Format("20060102")
	// 来源网络标识：IPv4 用完整地址（CGNAT 下多人共享地址只会让来源数更保守），
	// IPv6 掩到 /64——隐私扩展地址会让同一个人的一天出现大量不同地址，只有按 /64
	// 归并才代表"一个网络"。
	network := strings.TrimSpace(obs.ClientIp)
	if addr, err := netip.ParseAddr(network); err == nil {
		switch {
		case addr.Is4() || addr.Is4In6():
			network = addr.Unmap().String()
		default:
			if prefix, err := addr.Prefix(64); err == nil {
				network = prefix.Masked().String()
			}
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	fpDayKey := fmt.Sprintf("risk:fpday:%d:%s", obs.TokenId, day)
	fpCountKey := fmt.Sprintf("risk:fpcount:%d:%s", obs.TokenId, day)
	pipe := common.RDB.TxPipeline()
	pipe.PFAdd(ctx, fpDayKey, obs.Fingerprint)
	pipe.Expire(ctx, fpDayKey, riskDailyKeyTTL)
	pipe.HIncrBy(ctx, fpCountKey, obs.Fingerprint, 1)
	pipe.Expire(ctx, fpCountKey, riskDailyKeyTTL)
	if network != "" {
		// 来源网络计数按令牌分键：令牌数是业务规模，不像指纹那样由请求头决定，
		// 因此这个键族的数量可控。
		netCountKey := fmt.Sprintf("risk:tokenip:%d:%s", obs.TokenId, day)
		pipe.HIncrBy(ctx, netCountKey, network, 1)
		pipe.Expire(ctx, netCountKey, riskDailyKeyTTL)
	}
	if obs.UserId > 0 {
		// 聚类明细按天分键、按账号分字段：账号当天的来源网络、首末出现时间与最后使用的
		// 令牌一起写入，扫描时只统计当天真实出现过的账号。来源记录当天最后一次请求的地址，
		// 中途换网的账号只按最后一次来源参与聚类（宁可漏报，也不把不同网络聚成一簇）。
		account := fmt.Sprintf("u%d:", obs.UserId)
		netKey := fmt.Sprintf("risk:fpnet:%s:%s", obs.Fingerprint, day)
		pipe.HIncrBy(ctx, netKey, account+"n", 1)
		pipe.HSet(ctx, netKey, account+"ip", network, account+"t", now.Unix(), account+"k", obs.TokenId)
		pipe.HSetNX(ctx, netKey, account+"f", now.Unix())
		pipe.Expire(ctx, netKey, riskFpNetKeyTTL)
	}
	if clientJSON, err := common.Marshal(obs.Client); err != nil {
		common.SysError("risk client identity marshal failed: " + err.Error())
	} else {
		clientKey := fmt.Sprintf("risk:fpclient:%s", obs.Fingerprint)
		pipe.Set(ctx, clientKey, clientJSON, riskFpClientKeyTTL)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		common.SysError("risk fingerprint daily record failed: " + err.Error())
	}
}

// RunRiskDailyScan 扫描前一天的日多样性数据与跨账号聚类数据，产出 fp_burst /
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
	if setting.DailySourceIpThreshold > 0 {
		scanDailySourceNetworks(ctx, yesterday, setting)
	}
	if setting.CrossUserThreshold > 0 {
		scanCrossUserFingerprints(ctx, yesterday, setting)
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

// scanDailySourceNetworks 遍历昨日 risk:tokenip:*，对当日来源网络数超阈值的令牌记录
// ip_burst 事件。
//
// 这是"key 被挂到网上卖"最直接的一类证据，也是指纹信号的兜底：指纹只标识客户端软件，
// 卖家统一发放同一款客户端时所有买家指纹相同，fp_burst 会看到"只有一个客户端"，而买家
// 各自的网络不会重合，来源网络数照样发散。与 fp_burst 一致，来源地址同样要求请求数达到
// MinRequestsPerFingerprint 才算数，避免泄漏后被扫描器逐个地址试一次就把来源数抬高。
func scanDailySourceNetworks(ctx context.Context, day string, setting risk_setting.RiskSetting) {
	var cursor uint64
	for {
		keys, next, err := common.RDB.Scan(ctx, cursor, "risk:tokenip:*:"+day, 100).Result()
		if err != nil {
			common.SysError("risk source network scan failed: " + err.Error())
			return
		}
		for _, key := range keys {
			tokenId, ok := tokenIdFromRiskKey(key, "risk:tokenip:")
			if !ok || risk_setting.IsTrustedToken(tokenId) {
				continue
			}
			counts, err := common.RDB.HGetAll(ctx, key).Result()
			if err != nil {
				continue
			}
			refs := make([]riskSourceNetworkRef, 0, len(counts))
			for network, raw := range counts {
				count, err := strconv.ParseInt(raw, 10, 64)
				if err != nil || count < int64(setting.MinRequestsPerFingerprint) {
					continue
				}
				refs = append(refs, riskSourceNetworkRef{Network: network, Requests: count})
			}
			if len(refs) < setting.DailySourceIpThreshold {
				continue
			}
			validCount := len(refs)
			slices.SortFunc(refs, func(a, b riskSourceNetworkRef) int {
				switch {
				case a.Requests > b.Requests:
					return -1
				case a.Requests < b.Requests:
					return 1
				default:
					return strings.Compare(a.Network, b.Network)
				}
			})
			if len(refs) > riskEvidenceSourceNetworkLimit {
				refs = refs[:riskEvidenceSourceNetworkLimit]
			}
			userId := riskTokenUserId(tokenId)
			evidence := marshalRiskEvidence(riskIpBurstEvidence{
				DistinctSourceNetworks: len(counts),
				ValidSourceNetworks:    validCount,
				Threshold:              setting.DailySourceIpThreshold,
				SourceNetworks:         refs,
			})
			model.RecordTokenRiskEventFromSample(userId, tokenId, risk_setting.RiskEventIpBurst, evidence, time.Now())
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
}

// scanCrossUserFingerprints 遍历昨日 risk:fpnet:*:{day}，把同一指纹下、来源 IP 相同的
// 账号聚成一簇，簇内账号数达到阈值即记录 fp_cross_user 事件。
//
// 限定同源 IP 是必要前提：指纹只由请求头计算，标识的是客户端软件而不是某台设备或某个人
// （同一个客户端版本、同一个系统语言的两个人指纹完全相同），单看指纹会把互不相干的用户
// 聚成一簇。加上来源 IP 之后，信号才指向可核查的行为——同一网络下的同一客户端被多个账号
// 使用。
func scanCrossUserFingerprints(ctx context.Context, day string, setting risk_setting.RiskSetting) {
	var cursor uint64
	for {
		keys, next, err := common.RDB.Scan(ctx, cursor, "risk:fpnet:*:"+day, 100).Result()
		if err != nil {
			common.SysError("risk cross-user scan failed: " + err.Error())
			return
		}
		for _, key := range keys {
			fp := fingerprintFromRiskNetKey(key)
			if fp == "" {
				continue
			}
			records, err := common.RDB.HGetAll(ctx, key).Result()
			if err != nil {
				continue
			}
			// 请求数低于最小请求数的账号不计入聚类：只顺手试过一次的账号不应因为
			// 撞上同一个公共客户端而进簇。
			accounts := riskNetAccountsFromHash(records, setting.MinRequestsPerFingerprint)
			if len(accounts) < setting.CrossUserThreshold {
				continue
			}
			byIp := make(map[string][]riskCrossUserAccount, len(accounts))
			for _, account := range accounts {
				byIp[account.ClientIp] = append(byIp[account.ClientIp], account)
			}
			for ip, group := range byIp {
				if len(group) < setting.CrossUserThreshold {
					continue
				}
				slices.SortFunc(group, func(a, b riskCrossUserAccount) int {
					switch {
					case a.Requests > b.Requests:
						return -1
					case a.Requests < b.Requests:
						return 1
					default:
						return a.UserId - b.UserId
					}
				})
				recordCrossUserEvent(ctx, fp, ip, group, setting)
			}
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
}

// fingerprintFromRiskNetKey 从形如 risk:fpnet:{fp}:{day} 的 key 解析指纹，格式不符时
// 返回空串。
func fingerprintFromRiskNetKey(key string) string {
	rest, ok := strings.CutPrefix(key, "risk:fpnet:")
	if !ok {
		return ""
	}
	fp, _, found := strings.Cut(rest, ":")
	if !found {
		return ""
	}
	return fp
}

// riskNetAccountsFromHash 把 risk:fpnet 的 Hash 明细还原成账号记录，field 形如
// u{user_id}:{n|ip|t|f|k}；请求数低于 minRequests 或没有来源 IP 的账号被剔除，
// 因此这些账号不参与聚类。
func riskNetAccountsFromHash(records map[string]string, minRequests int) []riskCrossUserAccount {
	byUser := make(map[int]*riskCrossUserAccount, len(records)/5+1)
	for field, value := range records {
		rest, ok := strings.CutPrefix(field, "u")
		if !ok {
			continue
		}
		userPart, attribute, found := strings.Cut(rest, ":")
		if !found {
			continue
		}
		userId, err := strconv.Atoi(userPart)
		if err != nil || userId <= 0 {
			continue
		}
		account, ok := byUser[userId]
		if !ok {
			account = &riskCrossUserAccount{UserId: userId}
			byUser[userId] = account
		}
		switch attribute {
		case "n":
			account.Requests, _ = strconv.ParseInt(value, 10, 64)
		case "ip":
			account.ClientIp = value
		case "t":
			account.LastSeen, _ = strconv.ParseInt(value, 10, 64)
		case "f":
			account.FirstSeen, _ = strconv.ParseInt(value, 10, 64)
		case "k":
			account.TokenId, _ = strconv.Atoi(value)
		}
	}
	accounts := make([]riskCrossUserAccount, 0, len(byUser))
	for _, account := range byUser {
		if account.Requests < int64(minRequests) || account.ClientIp == "" {
			continue
		}
		accounts = append(accounts, *account)
	}
	return accounts
}

// recordCrossUserEvent 把一个 (指纹, 来源 IP) 下的账号簇记为 fp_cross_user 事件。
// 事件归属簇内请求数最多、令牌又不在信任白名单里的账号；证据给出该指纹对应的客户端
// 标识、账号共用的来源 IP，以及每个账号的请求数与首末出现时间，便于管理员核对是什么
// 客户端在哪些账号上共用、发生在当天的什么时间。
func recordCrossUserEvent(ctx context.Context, fp string, ip string, group []riskCrossUserAccount, setting risk_setting.RiskSetting) {
	owner := -1
	for i, account := range group {
		if account.TokenId > 0 && risk_setting.IsTrustedToken(account.TokenId) {
			continue
		}
		owner = i
		break
	}
	if owner < 0 {
		return
	}
	userIds := make([]int, 0, len(group))
	for _, account := range group {
		userIds = append(userIds, account.UserId)
	}
	usernameById := model.GetUsernamesByIds(userIds)
	for i := range group {
		if username := usernameById[group[i].UserId]; username != "" {
			group[i].Username = username
			continue
		}
		group[i].Username = "#" + strconv.Itoa(group[i].UserId)
	}
	// 客户端标识由请求时随指纹写入，存活期短于聚类明细：指纹在 48 小时内活跃过才有
	// 标识，否则证据只保留指纹、来源 IP 与账号。
	client := readRiskClientIdentities(ctx, []string{fp})[fp]
	evidence := marshalRiskEvidence(riskCrossUserEvidence{
		Fingerprint:        fp,
		riskClientIdentity: client,
		SourceIp:           ip,
		Accounts:           group,
		UserCount:          len(group),
		Threshold:          setting.CrossUserThreshold,
	})
	model.RecordTokenRiskEventFromSample(group[owner].UserId, group[owner].TokenId, risk_setting.RiskEventFpCrossUser, evidence, time.Now())
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
