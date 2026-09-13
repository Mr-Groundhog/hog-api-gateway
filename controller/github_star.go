package controller

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// GetGithubStarRewardStatus 返回当前用户的 GitHub Star 奖励活动状态：
// 活动是否可领取、目标仓库、奖励额度、GitHub 绑定情况与既有领取记录，
// 供前端渲染领取入口。
func GetGithubStarRewardStatus(c *gin.Context) {
	userId := c.GetInt("id")
	if userId == 0 {
		common.ApiError(c, errors.New("用户未登录"))
		return
	}
	active := service.GithubStarRewardActive()

	user, err := model.GetUserById(userId, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// github_bound 表示绑定值可直接用于 Star 比对。旧版本账号可能保存的是
	// GitHub 登录名而非数字 ID，这类绑定无法比对，按未绑定处理并提示重新绑定。
	_, githubIdParseErr := strconv.ParseInt(user.GitHubId, 10, 64)

	data := gin.H{
		"enabled":      active,
		"campaign_key": common.GithubStarCampaign,
		"github_bound": user.GitHubId != "" && githubIdParseErr == nil,
	}
	if active {
		data["repository"] = common.GithubStarRepository()
		data["repository_url"] = common.GithubStarRepositoryURL()
		data["reward_quota"] = common.GithubStarRewardQuota
	} else if common.GithubStarRewardEnabled && c.GetInt("role") >= common.RoleAdminUser {
		// 仅管理员可见的未生效原因：开关已打开但配置不完整时，入口不会显示，
		// 这里返回缺失项便于排查（管理员登录后直接访问本接口查看）。
		var missing []string
		if common.GithubStarAccessToken == "" {
			missing = append(missing, "Access Token (PAT)")
		}
		if common.GithubStarOwner == "" || common.GithubStarRepo == "" {
			missing = append(missing, "Repository Owner / Name")
		}
		if common.GithubStarRewardQuota <= 0 {
			missing = append(missing, "Reward Quota > 0")
		}
		if len(missing) > 0 {
			data["inactive_reason"] = "missing: " + strings.Join(missing, ", ")
		}
	}

	claim, err := model.GetGithubStarRewardClaimByUserOrGithub(common.GithubStarCampaign, userId, user.GitHubId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	data["claim"] = claim
	common.ApiSuccess(c, data)
}

// ClaimGithubStarReward 处理用户的 GitHub Star 奖励申请（方案第 6 节）：
// 服务端从当前登录用户读取绑定的 GitHub 数字 ID（绝不信任前端传入），
// 优先查本地 Stargazers 缓存、未命中再实时分页比对，验证通过后落一条
// 待管理员审批的申请记录（pending，不动额度），批准后才发放。检测失败
// 一律返回「稍后重试」，不当作未 Star。
func ClaimGithubStarReward(c *gin.Context) {
	userId := c.GetInt("id")
	if userId == 0 {
		common.ApiError(c, errors.New("用户未登录"))
		return
	}
	now := time.Now().Unix()
	requestId := c.GetString(common.RequestIdKey)

	if !service.GithubStarRewardActive() {
		common.ApiErrorMsg(c, "GitHub Star 奖励活动未开启或已结束")
		return
	}

	user, err := model.GetUserById(userId, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if _, parseErr := strconv.ParseInt(user.GitHubId, 10, 64); parseErr != nil {
		common.ApiErrorMsg(c, "GitHub 账号绑定信息异常，请解绑后重新绑定 GitHub 账号")
		return
	}

	existing, err := model.GetGithubStarRewardClaimByUserOrGithub(common.GithubStarCampaign, userId, user.GitHubId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	audit := &model.GithubStarAuditLog{
		CampaignKey: common.GithubStarCampaign,
		UserId:      userId,
		GithubId:    user.GitHubId,
		Action:      model.GithubStarAuditActionClaim,
		RequestId:   requestId,
	}

	// 被拒绝的申请允许用户重新提交（确认已 Star 后再次领取）；其余状态
	// （审核中 / 已发放 / 已撤销）一律拒绝重复领取。
	if existing != nil && existing.Status != model.GithubStarClaimStatusRejected {
		audit.Result = model.GithubStarAuditResultAlreadyClaimed
		audit.Detail = "existing status: " + existing.Status
		audit.ClaimId = existing.Id
		model.RecordGithubStarAuditLog(audit)
		if existing.Status == model.GithubStarClaimStatusPending {
			common.ApiErrorMsg(c, "GitHub Star 奖励申请正在审核中，请勿重复提交")
		} else {
			common.ApiErrorMsg(c, model.ErrGithubStarClaimAlreadyTaken.Error())
		}
		return
	}

	// 检测：先查本地缓存（定时同步维护），未命中再实时分页查询，
	// 以减少新增 Star 尚未同步时的误判（方案第 10 节）。
	matched := false
	page := 0
	starredAt := int64(0)
	githubLogin := ""
	stargazer, err := model.GetGithubStargazer(common.GithubStarCampaign, user.GitHubId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if stargazer != nil {
		matched = true
		starredAt = stargazer.StarredAt
		githubLogin = stargazer.GithubLogin
	} else {
		result := service.CheckGithubStarByGithubId(c.Request.Context(), user.GitHubId)
		page = result.Page
		audit.GithubPage = result.Page
		audit.GithubStatusCode = result.StatusCode
		if result.Err != nil {
			audit.Result = model.GithubStarAuditResultError
			if result.TokenFailed {
				audit.Result = model.GithubStarAuditResultTokenInvalid
			}
			audit.Detail = result.Err.Error()
			model.RecordGithubStarAuditLog(audit)
			logger.LogWarn(c.Request.Context(), fmt.Sprintf("github star check failed (user_id=%d): %v", userId, result.Err))
			common.ApiErrorMsg(c, "暂时无法完成 GitHub 验证，请稍后重试")
			return
		}
		matched = result.Matched
		starredAt = result.StarredAt
		githubLogin = result.GithubLogin
	}
	audit.Matched = &matched

	if !matched {
		audit.Result = model.GithubStarAuditResultNotStarred
		model.RecordGithubStarAuditLog(audit)
		common.ApiErrorMsg(c, "未检测到你的 GitHub 账号已 Star 指定仓库")
		return
	}

	// 灰度模式（方案第 12 节）：照常检测与审计，但不落领取记录、不修改额度，
	// 关闭灰度后用户仍可正常领取。
	if common.GithubStarRewardDryRun {
		audit.Result = model.GithubStarAuditResultGrantedDryRun
		audit.Detail = fmt.Sprintf("dry run: would grant %d quota", common.GithubStarRewardQuota)
		model.RecordGithubStarAuditLog(audit)
		common.ApiSuccess(c, gin.H{
			"status":         "granted",
			"quota":          0,
			"dry_run":        true,
			"repository_url": common.GithubStarRepositoryURL(),
		})
		return
	}

	claim := &model.GithubStarRewardClaim{
		CampaignKey:        common.GithubStarCampaign,
		UserId:             userId,
		GithubId:           user.GitHubId,
		GithubLogin:        githubLogin,
		Repository:         common.GithubStarRepository(),
		RewardQuota:        common.GithubStarRewardQuota,
		Status:             model.GithubStarClaimStatusPending,
		VerificationMethod: "github_app",
		StargazerPage:      page,
		StarredAt:          starredAt,
		GithubCheckedAt:    now,
		RequestId:          requestId,
	}
	if err := model.CreatePendingGithubStarRewardClaim(claim); err != nil {
		if errors.Is(err, model.ErrGithubStarClaimAlreadyTaken) {
			audit.Result = model.GithubStarAuditResultAlreadyClaimed
			audit.Detail = "concurrent claim hit unique constraint"
			model.RecordGithubStarAuditLog(audit)
			common.ApiErrorMsg(c, model.ErrGithubStarClaimAlreadyTaken.Error())
			return
		}
		audit.Result = model.GithubStarAuditResultError
		audit.Detail = "submit: " + err.Error()
		model.RecordGithubStarAuditLog(audit)
		common.ApiError(c, err)
		return
	}

	audit.ClaimId = claim.Id
	audit.Result = model.GithubStarAuditResultSubmitted
	model.RecordGithubStarAuditLog(audit)
	common.ApiSuccess(c, gin.H{
		"status":         model.GithubStarClaimStatusPending,
		"quota":          0,
		"repository_url": common.GithubStarRepositoryURL(),
	})
}

// GetGithubStarRewardClaims 分页查询奖励领取记录，供管理员复审（方案 8.1）。
func GetGithubStarRewardClaims(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	userId, _ := strconv.Atoi(c.Query("user_id"))
	filter := model.GithubStarClaimFilter{
		CampaignKey: c.Query("campaign_key"),
		Status:      c.Query("status"),
		UserId:      userId,
		GithubId:    c.Query("github_id"),
		Keyword:     c.Query("keyword"),
	}
	if startTimestamp, err := strconv.ParseInt(c.Query("start_timestamp"), 10, 64); err == nil {
		filter.StartTimestamp = startTimestamp
	}
	if endTimestamp, err := strconv.ParseInt(c.Query("end_timestamp"), 10, 64); err == nil {
		filter.EndTimestamp = endTimestamp
	}

	claims, total, err := model.GetGithubStarRewardClaims(filter, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(claims)
	common.ApiSuccess(c, pageInfo)
}

// GetGithubStarAuditLogs 分页查询 GitHub Star 检测与操作审计日志。
func GetGithubStarAuditLogs(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	claimId, _ := strconv.Atoi(c.Query("claim_id"))
	userId, _ := strconv.Atoi(c.Query("user_id"))
	filter := model.GithubStarAuditFilter{
		ClaimId:  claimId,
		UserId:   userId,
		GithubId: c.Query("github_id"),
		Action:   c.Query("action"),
	}

	logs, total, err := model.GetGithubStarAuditLogs(filter, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(logs)
	common.ApiSuccess(c, pageInfo)
}

// RecheckGithubStarRewardClaim 管理员复审：对指定领取记录实时重新检测当前
// Star 状态（方案 8.2）。检测结果只写入审计日志供比对，不修改原始领取记录、
// 不自动撤销——用户当前取消 Star 不等于申请时未 Star，是否撤销由管理员决定。
func RecheckGithubStarRewardClaim(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的记录 ID")
		return
	}
	claim, err := model.GetGithubStarRewardClaimById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	result := service.CheckGithubStarByGithubId(c.Request.Context(), claim.GithubId)
	matched := result.Matched
	audit := &model.GithubStarAuditLog{
		ClaimId:          claim.Id,
		CampaignKey:      claim.CampaignKey,
		UserId:           claim.UserId,
		GithubId:         claim.GithubId,
		Action:           model.GithubStarAuditActionRecheck,
		GithubStatusCode: result.StatusCode,
		GithubPage:       result.Page,
		Matched:          &matched,
		OperatorId:       c.GetInt("id"),
		RequestId:        c.GetString(common.RequestIdKey),
	}
	if result.Err != nil {
		audit.Result = model.GithubStarAuditResultError
		audit.Detail = result.Err.Error()
		model.RecordGithubStarAuditLog(audit)
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("github star recheck failed (claim_id=%d): %v", claim.Id, result.Err))
		common.ApiErrorMsg(c, "暂时无法完成 GitHub 验证，请稍后重试")
		return
	}
	audit.Result = model.GithubStarAuditResultRecheckDone
	audit.Detail = fmt.Sprintf("current starred_at=%d login=%s", result.StarredAt, result.GithubLogin)
	model.RecordGithubStarAuditLog(audit)

	common.ApiSuccess(c, gin.H{
		"claim": claim,
		"current": gin.H{
			"matched":    matched,
			"starred_at": result.StarredAt,
			"page":       result.Page,
			"checked_at": time.Now().Unix(),
		},
	})
}

// ApproveGithubStarRewardClaim 管理员批准发放：事务内把申请记录置为 granted
// 并增加用户额度。待审批（pending）与已拒绝（rejected，用于管理员反悔补救）
// 的记录均可批准；已发放/已撤销的记录批准时报错，不会重复加额度。
func ApproveGithubStarRewardClaim(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的记录 ID")
		return
	}
	claim, err := model.ApproveGithubStarRewardClaim(id, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}

	model.RecordGithubStarAuditLog(&model.GithubStarAuditLog{
		ClaimId:     claim.Id,
		CampaignKey: claim.CampaignKey,
		UserId:      claim.UserId,
		GithubId:    claim.GithubId,
		Action:      model.GithubStarAuditActionApprove,
		Result:      model.GithubStarAuditResultApproved,
		OperatorId:  c.GetInt("id"),
		RequestId:   c.GetString(common.RequestIdKey),
	})
	recordManageAuditFor(c, claim.UserId, "github_star.approve", map[string]any{
		"claim_id": claim.Id,
		"quota":    logger.LogQuota(claim.RewardQuota),
	})
	common.ApiSuccess(c, claim)
}

// RejectGithubStarRewardClaim 管理员拒绝待审批申请：记录置为 rejected，不动
// 用户额度（申请从未发放）。拒绝原因必填，与操作人、时间一并写入记录与审计。
func RejectGithubStarRewardClaim(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的记录 ID")
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "无效的参数")
		return
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		common.ApiErrorMsg(c, "请填写拒绝原因")
		return
	}

	claim, err := model.RejectGithubStarRewardClaim(id, c.GetInt("id"), reason)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	model.RecordGithubStarAuditLog(&model.GithubStarAuditLog{
		ClaimId:     claim.Id,
		CampaignKey: claim.CampaignKey,
		UserId:      claim.UserId,
		GithubId:    claim.GithubId,
		Action:      model.GithubStarAuditActionReject,
		Result:      model.GithubStarAuditResultRejectedByAdmin,
		OperatorId:  c.GetInt("id"),
		Detail:      "reason: " + reason,
		RequestId:   c.GetString(common.RequestIdKey),
	})
	recordManageAuditFor(c, claim.UserId, "github_star.reject", map[string]any{
		"claim_id": claim.Id,
		"reason":   reason,
	})
	common.ApiSuccess(c, claim)
}

// RevokeGithubStarRewardClaim 管理员撤销奖励（方案 8.3）：事务内把记录置为
// revoked、扣除已发放额度并写入用户额度日志，同时记录管理员身份与原因。
func RevokeGithubStarRewardClaim(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的记录 ID")
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "无效的参数")
		return
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		common.ApiErrorMsg(c, "请填写撤销原因")
		return
	}

	claim, err := model.RevokeGithubStarRewardClaim(id, c.GetInt("id"), reason)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	model.RecordGithubStarAuditLog(&model.GithubStarAuditLog{
		ClaimId:     claim.Id,
		CampaignKey: claim.CampaignKey,
		UserId:      claim.UserId,
		GithubId:    claim.GithubId,
		Action:      model.GithubStarAuditActionRevoke,
		Result:      model.GithubStarAuditResultRevokeDone,
		OperatorId:  c.GetInt("id"),
		Detail:      "reason: " + reason,
		RequestId:   c.GetString(common.RequestIdKey),
	})
	recordManageAuditFor(c, claim.UserId, "github_star.revoke", map[string]any{
		"claim_id": claim.Id,
		"quota":    logger.LogQuota(claim.RewardQuota),
		"reason":   reason,
	})
	common.ApiSuccess(c, claim)
}
