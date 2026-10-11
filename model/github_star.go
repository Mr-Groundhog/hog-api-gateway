package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 领取记录状态。系统检测通过的申请先落 pending 记录等待管理员审批，批准后才
// 发放额度（granted）；管理员可拒绝待审批申请（rejected）或撤销已发放奖励
// （revoked）。检测失败的申请（未 Star、GitHub 异常等）不落领取记录，只写审计
// 日志，用户可在补 Star 或服务恢复后重试；因此 (github_id, campaign_key) 与
// (user_id, campaign_key) 两个唯一约束即为「每个 GitHub 账号 / 每个站内账号
// 只能领取一次」的最终防线（方案 9.2）。
const (
	GithubStarClaimStatusPending  = "pending"
	GithubStarClaimStatusGranted  = "granted"
	GithubStarClaimStatusRejected = "rejected"
	GithubStarClaimStatusRevoked  = "revoked"
)

// 审计日志 action 取值。
const (
	GithubStarAuditActionClaim   = "claim"   // 用户申请（含系统检测结果）
	GithubStarAuditActionApprove = "approve" // 管理员批准发放
	GithubStarAuditActionReject  = "reject"  // 管理员拒绝申请
	GithubStarAuditActionRecheck = "recheck" // 管理员复审重新检测
	GithubStarAuditActionRevoke  = "revoke"  // 管理员撤销奖励
	GithubStarAuditActionSync    = "sync"    // Stargazers 定时同步
)

// 审计日志 result 取值。检测类失败（Token 无效、API 异常）不能当作「未 Star」
// （方案 9.5），因此拒绝结果细分了原因，供管理员复审判断。
const (
	GithubStarAuditResultSubmitted       = "submitted"       // 申请通过系统检测，等待管理员审批
	GithubStarAuditResultGrantedDryRun   = "granted_dry_run" // 灰度模式：检测通过但不落记录不发额度
	GithubStarAuditResultAlreadyClaimed  = "already_claimed"
	GithubStarAuditResultNotStarred      = "rejected_not_starred"
	GithubStarAuditResultTokenInvalid    = "rejected_token"
	GithubStarAuditResultError           = "rejected_error"
	GithubStarAuditResultApproved        = "approved"          // 管理员批准，额度已发放
	GithubStarAuditResultRejectedByAdmin = "rejected_by_admin" // 管理员拒绝申请
	GithubStarAuditResultRecheckDone     = "recheck_done"
	GithubStarAuditResultRevokeDone      = "revoke_done"
	GithubStarAuditResultSyncSuccess     = "sync_success"
	GithubStarAuditResultSyncFailed      = "sync_failed"
)

var (
	ErrGithubStarClaimNotFound     = errors.New("GitHub Star 奖励记录不存在")
	ErrGithubStarClaimAlreadyTaken = errors.New("该 GitHub 账号已经领取过本活动奖励")
	ErrGithubStarClaimNotGranted   = errors.New("该记录当前不是已发放状态，无法撤销")
	ErrGithubStarClaimNotPending   = errors.New("该记录当前不是待审批状态，无法执行此操作")
	ErrGithubStarQuotaOverflow     = errors.New("您的额度已接近上限，无法发放本次奖励，请先消耗部分额度后再试")
)

// GithubStarRewardClaim 记录一次通过系统检测的 GitHub Star 奖励申请及其审批
// 结果，是防重复发放的核心表。表名：github_star_reward_claims
type GithubStarRewardClaim struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`                                                                                                            // 主键，自增 ID
	CampaignKey string `json:"campaign_key" gorm:"type:varchar(64);not null;uniqueIndex:ux_github_star_claim_github_campaign;uniqueIndex:ux_github_star_claim_user_campaign"` // 活动标识（common.GithubStarCampaign），与 GithubId / UserId 分别组成联合唯一约束
	UserId      int    `json:"user_id" gorm:"not null;uniqueIndex:ux_github_star_claim_user_campaign;index:idx_github_star_claim_user"`                                       // 领取用户 ID
	GithubId    string `json:"github_id" gorm:"type:varchar(64);not null;uniqueIndex:ux_github_star_claim_github_campaign"`                                                   // 领取时用户绑定的 GitHub 数字用户 ID（十进制字符串），与 users.github_id 同源
	GithubLogin string `json:"github_login" gorm:"type:varchar(255);not null;default:''"`                                                                                     // 领取时检测到的 GitHub 登录名快照，仅用于管理员复审展示
	Repository  string `json:"repository" gorm:"type:varchar(512);not null;default:''"`                                                                                       // 领取时的目标仓库快照（owner/repo），活动配置变更后记录仍可读
	RewardQuota int    `json:"reward_quota" gorm:"not null"`                                                                                                                  // 申请时的奖励额度快照（内部额度单位），管理员批准时按此发放
	Status      string `json:"status" gorm:"type:varchar(32);not null;index:idx_github_star_claim_status"`                                                                    // 记录状态：pending 待管理员审批 / granted 已批准发放 / rejected 管理员已拒绝 / revoked 管理员已撤销
	// VerificationMethod 检测方式快照，当前固定 github_app（GitHub App Installation Token）。
	VerificationMethod string `json:"verification_method" gorm:"type:varchar(32);not null;default:'github_app'"`
	// StargazerPage 实时分页检测时匹配到用户的页码；0 表示未知（来自本地缓存或字段缺失）。
	StargazerPage int   `json:"stargazer_page"`
	StarredAt     int64 `json:"starred_at"` // 用户 Star 该仓库的时间（Unix 秒，来自 GitHub star+json 响应），0 表示未知
	// GithubCheckedAt 本次检测完成时间（Unix 秒）。缓存命中时为读取缓存的时刻。
	GithubCheckedAt int64  `json:"github_checked_at" gorm:"bigint;not null"`
	GrantedAt       int64  `json:"granted_at" gorm:"bigint"`                                                // 额度发放时间（Unix 秒），管理员批准时写入；pending/rejected 为 0
	RequestId       string `json:"request_id" gorm:"type:varchar(64);not null;default:''"`                  // 发放请求的 Request ID，用于关联审计日志
	RevokedAt       int64  `json:"revoked_at" gorm:"bigint"`                                                // 管理员否定决定时间（Unix 秒）：rejected 记录拒绝时间，revoked 记录撤销时间
	RevokedBy       int    `json:"revoked_by"`                                                              // 执行否定决定（拒绝/撤销）的管理员用户 ID
	RevokeReason    string `json:"revoke_reason" gorm:"type:varchar(512);not null;default:''"`              // 管理员否定决定原因：rejected 记录拒绝原因，revoked 记录撤销原因
	CreatedTime     int64  `json:"created_time" gorm:"bigint;not null;index:idx_github_star_claim_created"` // 记录创建时间（Unix 秒），即用户申请时间
	UpdatedTime     int64  `json:"updated_time" gorm:"bigint;not null"`                                     // 记录最后变更时间（Unix 秒）
}

func (GithubStarRewardClaim) TableName() string {
	return "github_star_reward_claims"
}

// GithubStargazer 是目标仓库 Stargazers 的本地缓存（方案 4.3）。该表只是检测加速
// 手段：申请时优先查缓存、未命中再实时查询；它不是防重复发放的依据，也不会因
// 用户取消 Star 而触发撤销。表名：github_stargazers
type GithubStargazer struct {
	CampaignKey string `json:"campaign_key" gorm:"type:varchar(64);primaryKey"`                           // 活动标识，与 GithubId 组成复合主键
	GithubId    string `json:"github_id" gorm:"type:varchar(64);primaryKey"`                              // GitHub 数字用户 ID（十进制字符串）
	GithubLogin string `json:"github_login" gorm:"type:varchar(255);not null;default:''"`                 // GitHub 登录名快照（用户可改名，仅展示用）
	StarredAt   int64  `json:"starred_at"`                                                                // GitHub 返回的 Star 时间（Unix 秒），0 表示未知
	FirstSeenAt int64  `json:"first_seen_at" gorm:"bigint;not null"`                                      // 首次同步到本地的时间（Unix 秒）
	LastSeenAt  int64  `json:"last_seen_at" gorm:"bigint;not null;index:idx_github_stargazers_last_seen"` // 最近一次同步仍处于 Star 状态的时间（Unix 秒）
}

func (GithubStargazer) TableName() string {
	return "github_stargazers"
}

// GithubStarAuditLog 记录 GitHub Star 奖励相关的检测与操作证据（方案 4.4），
// 供管理员复审追溯「当时向 GitHub 请求了什么、返回了什么、谁做了后续操作」。
// 只保存请求元数据，禁止写入 Token 与私钥。表名：github_star_audit_logs
type GithubStarAuditLog struct {
	Id          int64  `json:"id" gorm:"primaryKey;autoIncrement"`                                                       // 主键，自增 ID
	ClaimId     int    `json:"claim_id" gorm:"index:idx_github_star_audit_claim"`                                        // 关联的领取记录 ID，检测失败的申请没有领取记录时为 0
	CampaignKey string `json:"campaign_key" gorm:"type:varchar(64);not null;default:''"`                                 // 活动标识
	UserId      int    `json:"user_id" gorm:"index:idx_github_star_audit_user"`                                          // 申请用户 ID，系统操作（同步）为 0
	GithubId    string `json:"github_id" gorm:"type:varchar(64);not null;default:'';index:idx_github_star_audit_github"` // 被检测的 GitHub 数字用户 ID
	Action      string `json:"action" gorm:"type:varchar(64);not null"`                                                  // 操作类型：claim / recheck / revoke / sync
	Result      string `json:"result" gorm:"type:varchar(64);not null"`                                                  // 操作结果，见 GithubStarAuditResult* 常量
	// GithubStatusCode 当时 GitHub API 返回的 HTTP 状态码，0 表示未发起请求（如缓存命中）。
	GithubStatusCode int `json:"github_status_code"`
	// GithubPage 实时分页检测到达的页码，0 表示未知。
	GithubPage int `json:"github_page"`
	// Matched 检测是否匹配到已 Star；nil 表示本次没有检测语义（如撤销、同步）。
	Matched    *bool `json:"matched"`
	OperatorId int   `json:"operator_id"` // 操作者用户 ID，系统自动操作为 0
	// Detail 补充说明（如同步页数、错误摘要），不含敏感凭据。
	Detail      string `json:"detail" gorm:"type:varchar(1024);not null;default:''"`
	RequestId   string `json:"request_id" gorm:"type:varchar(128);not null;default:''"`                 // 关联请求的 Request ID
	CreatedTime int64  `json:"created_time" gorm:"bigint;not null;index:idx_github_star_audit_created"` // 记录时间（Unix 秒）
}

func (GithubStarAuditLog) TableName() string {
	return "github_star_audit_logs"
}

// isGithubStarDuplicateKeyError 跨库识别唯一键冲突（MySQL 1062 / PostgreSQL 23505 /
// SQLite UNIQUE constraint failed）。领取并发插入撞唯一索引时用于区分
// 「已被领取」与真实数据库错误。
func isGithubStarDuplicateKeyError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "Duplicate entry") ||
		strings.Contains(msg, "duplicate key value") ||
		strings.Contains(msg, "UNIQUE constraint failed")
}

// GetGithubStarRewardClaimById 按主键读取一条领取记录。
func GetGithubStarRewardClaimById(id int) (*GithubStarRewardClaim, error) {
	if id <= 0 {
		return nil, ErrGithubStarClaimNotFound
	}
	claim := &GithubStarRewardClaim{}
	err := DB.First(claim, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrGithubStarClaimNotFound
	}
	if err != nil {
		return nil, err
	}
	return claim, nil
}

// GetGithubStarRewardClaimByUserOrGithub 按活动查找当前用户或其 GitHub 账号名下
// 的领取记录（两个维度任一命中即返回），用于领取前判重与用户状态展示。
func GetGithubStarRewardClaimByUserOrGithub(campaignKey string, userId int, githubId string) (*GithubStarRewardClaim, error) {
	if campaignKey == "" || (userId <= 0 && githubId == "") {
		return nil, nil
	}
	claim := &GithubStarRewardClaim{}
	err := DB.Where("campaign_key = ? AND (user_id = ? OR github_id = ?)", campaignKey, userId, githubId).
		First(claim).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return claim, nil
}

// CreatePendingGithubStarRewardClaim 落一条待管理员审批的申请记录：系统检测
// 通过后调用，此时不修改用户额度。上一次申请被管理员拒绝（rejected）的用户
// 可重新申请：同事务内先删除其 rejected 旧记录再插入新的 pending 记录，
// 拒绝痕迹保留在审计日志中。并发重复申请撞唯一索引时返回
// ErrGithubStarClaimAlreadyTaken，无其他副作用。
func CreatePendingGithubStarRewardClaim(claim *GithubStarRewardClaim) error {
	now := common.GetTimestamp()
	if claim.CreatedTime == 0 {
		claim.CreatedTime = now
	}
	claim.UpdatedTime = now
	claim.Status = GithubStarClaimStatusPending
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("campaign_key = ? AND (user_id = ? OR github_id = ?) AND status = ?",
			claim.CampaignKey, claim.UserId, claim.GithubId, GithubStarClaimStatusRejected).
			Delete(&GithubStarRewardClaim{}).Error; err != nil {
			return err
		}
		if err := tx.Create(claim).Error; err != nil {
			if isGithubStarDuplicateKeyError(err) {
				return ErrGithubStarClaimAlreadyTaken
			}
			return err
		}
		return nil
	})
}

// ApproveGithubStarRewardClaim 管理员批准一条待审批（或已拒绝后反悔）的申请：
// 单个事务内条件更新记录状态并条件增加用户额度，任一步失败整体回滚，不会出现
// 「记录已发放但额度未到账」的中间态。条件更新而非行锁，并发重复批准只生效
// 一次，SQLite 上同样竞态安全。
func ApproveGithubStarRewardClaim(claimId int, operatorId int) (*GithubStarRewardClaim, error) {
	now := common.GetTimestamp()
	claim := &GithubStarRewardClaim{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&GithubStarRewardClaim{}).
			Where("id = ? AND status IN ?", claimId, []string{GithubStarClaimStatusPending, GithubStarClaimStatusRejected}).
			Updates(map[string]any{
				"status":       GithubStarClaimStatusGranted,
				"granted_at":   now,
				"updated_time": now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrGithubStarClaimNotPending
		}
		if err := tx.First(claim, "id = ?", claimId).Error; err != nil {
			return err
		}
		// 条件加额度：WHERE 同时保证用户仍存在，且加完不会越过 int32 额度列上限。
		// claim.RewardQuota <= common.MaxQuota 由配置加载时校验保证。
		quotaResult := tx.Model(&User{}).
			Where("id = ? AND quota <= ?", claim.UserId, common.MaxQuota-claim.RewardQuota).
			Update("quota", gorm.Expr("quota + ?", claim.RewardQuota))
		if quotaResult.Error != nil {
			return quotaResult.Error
		}
		if quotaResult.RowsAffected != 1 {
			return ErrGithubStarQuotaOverflow
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// 数据库变更已提交，此时才同步额度缓存，缓存失败不影响已落库的发放结果。
	syncCreditUserQuotaCache(claim.UserId, claim.RewardQuota, "github star reward")
	RecordLog(claim.UserId, LogTypeTopup, common.NewMessage("GitHub Star 奖励发放成功，获得 {{quota}}（仓库 {{repository}}）",
		map[string]any{"quota": logger.FormatQuota(claim.RewardQuota), "repository": claim.Repository}))
	return claim, nil
}

// RejectGithubStarRewardClaim 管理员拒绝一条待审批申请：条件更新状态为
// rejected，不修改用户额度（申请从未发放）。拒绝的决策时间、操作人与原因记录
// 在 revoked_* 三列（与撤销共用：两者同为管理员否定决定）。并发重复拒绝只生效
// 一次。
func RejectGithubStarRewardClaim(claimId int, operatorId int, reason string) (*GithubStarRewardClaim, error) {
	now := common.GetTimestamp()
	claim := &GithubStarRewardClaim{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&GithubStarRewardClaim{}).
			Where("id = ? AND status = ?", claimId, GithubStarClaimStatusPending).
			Updates(map[string]any{
				"status":        GithubStarClaimStatusRejected,
				"revoked_at":    now,
				"revoked_by":    operatorId,
				"revoke_reason": reason,
				"updated_time":  now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrGithubStarClaimNotPending
		}
		return tx.First(claim, "id = ?", claimId).Error
	})
	if err != nil {
		return nil, err
	}

	RecordLog(claim.UserId, LogTypeSystem, common.NewMessage("GitHub Star 奖励申请被管理员拒绝（原因：{{reason}}）", map[string]any{"reason": reason}))
	return claim, nil
}

// RevokeGithubStarRewardClaim 在单个事务内撤销一条已发放的奖励：条件更新记录状态
// （仅 granted 可撤销，防并发重复撤销）、扣除已发放额度。用户余额不足时额度可能
// 扣为负数，属于正常追讨语义。返回撤销后的记录。
func RevokeGithubStarRewardClaim(claimId int, operatorId int, reason string) (*GithubStarRewardClaim, error) {
	now := common.GetTimestamp()
	claim := &GithubStarRewardClaim{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&GithubStarRewardClaim{}).
			Where("id = ? AND status = ?", claimId, GithubStarClaimStatusGranted).
			Updates(map[string]any{
				"status":        GithubStarClaimStatusRevoked,
				"revoked_at":    now,
				"revoked_by":    operatorId,
				"revoke_reason": reason,
				"updated_time":  now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrGithubStarClaimNotGranted
		}
		if err := tx.First(claim, "id = ?", claimId).Error; err != nil {
			return err
		}
		if err := tx.Model(&User{}).
			Where("id = ?", claim.UserId).
			Update("quota", gorm.Expr("quota - ?", claim.RewardQuota)).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	if err := cacheDecrUserQuota(claim.UserId, int64(claim.RewardQuota)); err != nil {
		common.SysLog(fmt.Sprintf("failed to sync github star reward revoke to user quota cache: %s", err.Error()))
	}
	RecordLog(claim.UserId, LogTypeSystem, common.NewMessage("GitHub Star 奖励被管理员撤销，扣除额度 {{quota}}（原因：{{reason}}）",
		map[string]any{"quota": logger.FormatQuota(claim.RewardQuota), "reason": reason}))
	return claim, nil
}

// GithubStarClaimFilter 是管理端领取记录列表的筛选条件（方案 8.1）。
type GithubStarClaimFilter struct {
	CampaignKey    string // 精确匹配活动标识，空表示全部活动
	Status         string // 精确匹配状态（granted / revoked），空表示全部
	UserId         int    // 精确匹配用户 ID，0 表示不过滤
	GithubId       string // 精确匹配 GitHub 数字用户 ID，空表示不过滤
	Keyword        string // 模糊匹配 GitHub 登录名或 GitHub ID
	StartTimestamp int64  // 申请时间（created_time）起始，0 表示不过滤
	EndTimestamp   int64  // 申请时间（created_time）截止，0 表示不过滤
}

// GetGithubStarRewardClaims 分页查询领取记录，按 ID 倒序。
func GetGithubStarRewardClaims(filter GithubStarClaimFilter, pageInfo *common.PageInfo) ([]*GithubStarRewardClaim, int64, error) {
	query := DB.Model(&GithubStarRewardClaim{})
	if filter.CampaignKey != "" {
		query = query.Where("campaign_key = ?", filter.CampaignKey)
	}
	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if filter.UserId > 0 {
		query = query.Where("user_id = ?", filter.UserId)
	}
	if filter.GithubId != "" {
		query = query.Where("github_id = ?", filter.GithubId)
	}
	if filter.Keyword != "" {
		keyword := "%" + filter.Keyword + "%"
		query = query.Where("github_login LIKE ? OR github_id LIKE ?", keyword, keyword)
	}
	if filter.StartTimestamp > 0 {
		query = query.Where("created_time >= ?", filter.StartTimestamp)
	}
	if filter.EndTimestamp > 0 {
		query = query.Where("created_time <= ?", filter.EndTimestamp)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var claims []*GithubStarRewardClaim
	err := query.Order("id DESC").
		Limit(pageInfo.GetPageSize()).
		Offset(pageInfo.GetStartIdx()).
		Find(&claims).Error
	return claims, total, err
}

// GetGithubStargazer 按活动与 GitHub ID 读取本地 Stargazers 缓存。
func GetGithubStargazer(campaignKey string, githubId string) (*GithubStargazer, error) {
	if campaignKey == "" || githubId == "" {
		return nil, nil
	}
	stargazer := &GithubStargazer{}
	err := DB.Where("campaign_key = ? AND github_id = ?", campaignKey, githubId).First(stargazer).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return stargazer, nil
}

// UpsertGithubStargazers 批量写入 Stargazers 同步结果：已存在的记录刷新登录名、
// Star 时间与 last_seen_at（first_seen_at 保持首次同步时间），不存在的插入。
// 复合主键 (campaign_key, github_id) 即冲突判定键，三种数据库均由 GORM OnConflict
// 子句翻译为各自的原生 upsert 语法。
func UpsertGithubStargazers(stargazers []*GithubStargazer) error {
	if len(stargazers) == 0 {
		return nil
	}
	return DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "campaign_key"}, {Name: "github_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"github_login", "starred_at", "last_seen_at",
		}),
	}).Create(&stargazers).Error
}

// RecordGithubStarAuditLog 写入一条检测/操作审计日志。失败只记系统日志，
// 不影响主流程（审计是证据留痕，不应让发放因审计写入失败而回滚）。
func RecordGithubStarAuditLog(entry *GithubStarAuditLog) {
	if entry.CreatedTime == 0 {
		entry.CreatedTime = common.GetTimestamp()
	}
	if err := DB.Create(entry).Error; err != nil {
		common.SysError("failed to record github star audit log: " + err.Error())
	}
}

// GithubStarAuditFilter 是审计日志查询条件。
type GithubStarAuditFilter struct {
	ClaimId  int    // 关联领取记录 ID，0 表示不过滤
	UserId   int    // 用户 ID，0 表示不过滤
	GithubId string // GitHub 数字用户 ID，空表示不过滤
	Action   string // 操作类型，空表示不过滤
}

// GetGithubStarAuditLogs 分页查询审计日志，按 ID 倒序。
func GetGithubStarAuditLogs(filter GithubStarAuditFilter, pageInfo *common.PageInfo) ([]*GithubStarAuditLog, int64, error) {
	query := DB.Model(&GithubStarAuditLog{})
	if filter.ClaimId > 0 {
		query = query.Where("claim_id = ?", filter.ClaimId)
	}
	if filter.UserId > 0 {
		query = query.Where("user_id = ?", filter.UserId)
	}
	if filter.GithubId != "" {
		query = query.Where("github_id = ?", filter.GithubId)
	}
	if filter.Action != "" {
		query = query.Where("action = ?", filter.Action)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var logs []*GithubStarAuditLog
	err := query.Order("id DESC").
		Limit(pageInfo.GetPageSize()).
		Offset(pageInfo.GetStartIdx()).
		Find(&logs).Error
	return logs, total, err
}
