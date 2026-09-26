package service

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/go-redis/redis/v8"

	"github.com/QuantumNous/new-api/common"
)

// 风控事件的证据快照。证据统一用这些结构经 common.Marshal 序列化后写入
// TokenRiskEvent.Evidence；字段名与前端 token-risk-tab 的证据标签映射一一对应，
// 改动字段名需同步前端。
//
// 证据必须由序列化器生成，禁止手工拼接 JSON：证据里含切片时手写拼接很容易漏掉
// 元素间的逗号，产生非法 JSON，前端 JSON.parse 失败后整条证据会被隐藏。
//
// 每种信号都要能自证：计数类字段说明"超了多少"，指纹明细（riskFingerprintRef）
// 说明"是哪些客户端"，客户端标识说明"这些指纹是什么软件"，跨用户信号再点名账号。

// riskEvidenceFingerprintLimit 是证据中列出的指纹条目上限。超出时按观测值降序
// 截断（总量仍由 distinct/valid/concurrent 等计数字段给出），避免证据无界增长。
const riskEvidenceFingerprintLimit = 5

// riskEvidenceSourceNetworkLimit 是 ip_burst 证据中列出的来源网络条目上限。来源网络的
// 发散程度本身就是信号，因此给出的明细比指纹明细多一些，仍按请求数降序截断。
const riskEvidenceSourceNetworkLimit = 10

// riskClientIdentity 是与指纹同源的客户端软件标识：取值来自计算指纹的同一组
// 请求头，因此同一指纹的客户端标识恒定，可直接作为证据说明"这个指纹是什么客户端"。
// 字段为空时从证据 JSON 中省略，前端不会渲染空行。
type riskClientIdentity struct {
	// UserAgent 是客户端 User-Agent，指认客户端软件与版本（超长时截断）。
	UserAgent string `json:"user_agent,omitempty"`
	// ClientVersion 是客户端自报版本（X-Client-Version 请求头），未上报时省略。
	ClientVersion string `json:"client_version,omitempty"`
	// Platform 是客户端平台（Sec-Ch-Ua-Platform 请求头，已去掉规范要求的引号），未上报时省略。
	Platform string `json:"platform,omitempty"`
}

// riskFingerprintRef 是证据中列出的单个客户端指纹明细：指纹本身、观测到的
// 请求数，以及该指纹对应的客户端标识（标识缺失时相关字段被省略）。
type riskFingerprintRef struct {
	// Fingerprint 是客户端指纹。
	Fingerprint string `json:"fingerprint"`
	// Requests 是观测到的请求数；并发类信号下表示触发时的在途请求数。
	Requests int64 `json:"requests"`
	// riskClientIdentity 平铺为证据字段（user_agent / client_version / platform）。
	riskClientIdentity
}

// riskConcurrentFpEvidence 是 concurrent_fp 事件的证据快照。
type riskConcurrentFpEvidence struct {
	// ConcurrentFingerprints 是触发时该令牌在途的不同客户端指纹数。
	ConcurrentFingerprints int64 `json:"concurrent_fingerprints"`
	// Threshold 是触发时的 MaxConcurrentFingerprints 配置值。
	Threshold int `json:"threshold"`
	// Fingerprints 是触发时在途的指纹明细，说明是哪些客户端在同时请求。
	Fingerprints []riskFingerprintRef `json:"fingerprints"`
}

// riskSingleFpEvidence 是 single_fp_concurrency 事件的证据快照。
type riskSingleFpEvidence struct {
	// SingleFpInflight 是触发时该指纹的在途请求数。
	SingleFpInflight int64 `json:"single_fp_inflight"`
	// Threshold 是触发时的 MaxConcurrentRequestsPerFingerprint 配置值。
	Threshold int `json:"threshold"`
	// Fingerprint 是触发（在途请求数超阈值）的客户端指纹。
	Fingerprint string `json:"fingerprint"`
	// riskClientIdentity 是该指纹对应的客户端标识。
	riskClientIdentity
}

// riskFpBurstEvidence 是 fp_burst 事件的证据快照。
type riskFpBurstEvidence struct {
	// DistinctFingerprints 是当日该令牌出现过的不同客户端指纹数。
	DistinctFingerprints int64 `json:"distinct_fingerprints"`
	// ValidFingerprints 是其中请求数达到 MinRequestsPerFingerprint 的指纹数。
	ValidFingerprints int `json:"valid_fingerprints"`
	// Threshold 是触发时的 DailyFingerprintThreshold 配置值。
	Threshold int `json:"threshold"`
	// Fingerprints 是当日请求数最多的有效指纹明细，按请求数降序，说明这些请求
	// 来自哪些客户端。
	Fingerprints []riskFingerprintRef `json:"fingerprints"`
}

// riskSourceNetworkRef 是 ip_burst 证据中列出的单个来源网络：来源地址（IPv6 为 /64
// 前缀）与当日请求数。
type riskSourceNetworkRef struct {
	// Network 是归一化后的来源网络：IPv4 是完整地址，IPv6 是 /64 前缀。
	Network string `json:"network"`
	// Requests 是当来自该来源的请求数。
	Requests int64 `json:"requests"`
}

// riskIpBurstEvidence 是 ip_burst 事件的证据快照：令牌当日出现过的不同来源网络数，
// 以及请求数最多的一批来源明细。个人自用的令牌通常只来自一两个网络，来源数发散是
// "key 被多人使用/被售卖"的直接迹象。
type riskIpBurstEvidence struct {
	// DistinctSourceNetworks 是当日该令牌出现过的不同来源网络数。
	DistinctSourceNetworks int `json:"distinct_source_networks"`
	// ValidSourceNetworks 是其中请求数达到 MinRequestsPerFingerprint 的来源网络数。
	ValidSourceNetworks int `json:"valid_source_networks"`
	// Threshold 是触发时的 DailySourceIpThreshold 配置值。
	Threshold int `json:"threshold"`
	// SourceNetworks 是请求数最多的来源网络明细，按请求数降序。
	SourceNetworks []riskSourceNetworkRef `json:"source_networks"`
}

// riskCrossUserAccount 是跨账号聚类证据里的单个账号：账号身份、当天该指纹下的请求数
// 与首末出现时间（秒）。时间让管理员判断关联是刚刚发生还是当天的旧数据，避免把留存的
// 旧观测当成新的请求。
type riskCrossUserAccount struct {
	// UserId 是账号 ID。
	UserId int `json:"user_id"`
	// Username 是账号名，账号已不存在时记为 "#{id}"。
	Username string `json:"username"`
	// TokenId 是该账号当天最后使用该指纹的令牌 ID。
	TokenId int `json:"token_id"`
	// Requests 是当天该指纹下该账号的请求数。
	Requests int64 `json:"requests"`
	// FirstSeen 是该账号当天首次以该指纹请求的时间戳（秒）。
	FirstSeen int64 `json:"first_seen"`
	// LastSeen 是该账号当天最后一次以该指纹请求的时间戳（秒）。
	LastSeen int64 `json:"last_seen"`
	// ClientIp 是该账号当天最后一次请求的来源 IP，聚类按它分组；簇内账号共用同一个
	// 来源 IP，由证据的 source_ip 字段统一给出，账号明细里不重复。
	ClientIp string `json:"-"`
}

// riskCrossUserEvidence 是 fp_cross_user 事件的证据快照：记录被多个账号共用的客户端
// 指纹、该指纹对应的客户端标识、账号共用的来源 IP，以及各账号的请求数与首末出现时间。
// 聚类按 (指纹, 来源 IP) 判定，因此证据里始终带出共用的来源 IP。
type riskCrossUserEvidence struct {
	// Fingerprint 是跨账号命中的客户端指纹。
	Fingerprint string `json:"fingerprint"`
	// riskClientIdentity 平铺为证据字段（user_agent / client_version / platform）。
	riskClientIdentity
	// SourceIp 是这些账号共用的来源 IP。
	SourceIp string `json:"source_ip"`
	// Accounts 是同一来源 IP 下共用该指纹的账号明细，按请求数降序。
	Accounts []riskCrossUserAccount `json:"accounts"`
	// UserCount 是关联账号数，等于 Accounts 长度。
	UserCount int `json:"user_count"`
	// Threshold 是触发时的 CrossUserThreshold 配置值。
	Threshold int `json:"threshold"`
}

// marshalRiskEvidence 将证据结构序列化为事件证据 JSON。序列化失败时返回空串，
// 事件照常记录（前端显示为空证据），不影响本轮扫描的其它事件。
func marshalRiskEvidence(payload any) string {
	raw, err := common.Marshal(payload)
	if err != nil {
		common.SysError("failed to marshal token risk evidence: " + err.Error())
		return ""
	}
	return string(raw)
}

// readRiskClientIdentities 批量读取指纹对应的客户端标识，供证据说明客户端是什么。
// 单次 pipeline 完成；key 缺失（标识已过期或指纹产生于旧版本）时不返回该指纹，
// 调用方按零值处理。
func readRiskClientIdentities(ctx context.Context, fingerprints []string) map[string]riskClientIdentity {
	identities := make(map[string]riskClientIdentity, len(fingerprints))
	if len(fingerprints) == 0 || common.RDB == nil {
		return identities
	}
	pipe := common.RDB.Pipeline()
	cmds := make([]*redis.StringCmd, 0, len(fingerprints))
	for _, fingerprint := range fingerprints {
		cmds = append(cmds, pipe.Get(ctx, fmt.Sprintf("risk:fpclient:%s", fingerprint)))
	}
	if _, err := pipe.Exec(ctx); err != nil && !errors.Is(err, redis.Nil) {
		common.SysError("risk client identity read failed: " + err.Error())
	}
	for i, cmd := range cmds {
		raw, err := cmd.Result()
		if err != nil || raw == "" {
			continue
		}
		var identity riskClientIdentity
		if err := common.UnmarshalJsonStr(raw, &identity); err != nil {
			common.SysError("risk client identity unmarshal failed: " + err.Error())
			continue
		}
		identities[fingerprints[i]] = identity
	}
	return identities
}

// buildRiskFingerprintRefs 把观测到的指纹明细整理成证据条目：按观测值降序
// （观测值相同时按指纹排序，保证证据稳定可复现），截断到
// riskEvidenceFingerprintLimit 条，并补上各指纹的客户端标识。
func buildRiskFingerprintRefs(ctx context.Context, refs []riskFingerprintRef) []riskFingerprintRef {
	if len(refs) == 0 {
		return nil
	}
	slices.SortFunc(refs, func(a, b riskFingerprintRef) int {
		switch {
		case a.Requests > b.Requests:
			return -1
		case a.Requests < b.Requests:
			return 1
		default:
			return strings.Compare(a.Fingerprint, b.Fingerprint)
		}
	})
	if len(refs) > riskEvidenceFingerprintLimit {
		refs = refs[:riskEvidenceFingerprintLimit]
	}
	fingerprints := make([]string, 0, len(refs))
	for _, ref := range refs {
		fingerprints = append(fingerprints, ref.Fingerprint)
	}
	identities := readRiskClientIdentities(ctx, fingerprints)
	for i := range refs {
		refs[i].riskClientIdentity = identities[refs[i].Fingerprint]
	}
	return refs
}
