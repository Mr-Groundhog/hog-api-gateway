package controller

import (
	"errors"
	"math"
	"net/http"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// maxBatchUserIds 是筛选预览 ids_only 与批量封禁/额度调整共同接受的最大用户数。
const maxBatchUserIds = 1000

// maxQuotaRatio 是倍率模式下「当前额度 × 倍率」允许的最大倍率。
const maxQuotaRatio = 10

// 批量操作按用户返回的失败原因（稳定标识，由前端本地化展示）。
const (
	batchFailureNotFound      = "not_found"
	batchFailureForbidden     = "forbidden_target"
	batchFailurePermission    = "permission_denied"
	batchFailureInvalidParams = "invalid_parameters"
	batchFailureQuotaLimit    = "quota_limit_exceeded"
	batchFailureRatioTooSmall = "ratio_too_small"
	batchFailureDatabase      = "database_error"
)

// UserBatchFailure 是批量操作中单个用户的失败结果。
type UserBatchFailure struct {
	Id     int    `json:"id"`
	Reason string `json:"reason"`
}

// UserFilterRequest 用户筛选预览请求。LastLoginBefore 与 LastCallBefore 同时
// 提供时取交集（AND）；时间阈值为 Unix 秒，表示「对应时间早于该值」。
type UserFilterRequest struct {
	LastLoginBefore *int64 `json:"last_login_before"`
	LastCallBefore  *int64 `json:"last_call_before"`
	Page            int    `json:"page"`
	PageSize        int    `json:"page_size"`
	IdsOnly         bool   `json:"ids_only"`
}

// UserFilterItem 是筛选预览的显式 DTO。不直接序列化完整 User，避免带出
// setting（webhook_secret、gotify_token）、OAuth 外部 ID、last_login_ip 等字段。
type UserFilterItem struct {
	Id          int    `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Role        int    `json:"role"`
	Status      int    `json:"status"`
	Quota       int    `json:"quota"`
	UsedQuota   int    `json:"used_quota"`
	Group       string `json:"group"`
	LastLoginAt int64  `json:"last_login_at"`
	// LastCallAt 仅在筛选条件包含「最近 API 调用时间」时返回，为最近一次消费日志时间。
	LastCallAt int64 `json:"last_call_at,omitempty"`
}

// FilterUsers 按活跃度条件预览候选用户；只读接口，不修改任何状态。
// 非 root 只能看到 role 低于自己的用户，root 排除 root 目标与操作者本人。
func FilterUsers(c *gin.Context) {
	var req UserFilterRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if req.LastLoginBefore == nil && req.LastCallBefore == nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if (req.LastLoginBefore != nil && *req.LastLoginBefore <= 0) || (req.LastCallBefore != nil && *req.LastCallBefore <= 0) {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	query := model.DB.Model(&model.User{}).
		Where("status != ?", common.UserStatusDisabled)
	query = userOperatorScope(query, c.GetInt("id"), c.GetInt("role"))
	if req.LastLoginBefore != nil {
		query = query.Where("last_login_at > ?", 0).Where("last_login_at < ?", *req.LastLoginBefore)
	}
	if req.LastCallBefore != nil {
		var recentCallerIDs []int
		if err := model.LOG_DB.Model(&model.Log{}).
			Where("created_at >= ?", *req.LastCallBefore).
			Where("type = ?", model.LogTypeConsume).
			Distinct("user_id").
			Pluck("user_id", &recentCallerIDs).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		if len(recentCallerIDs) > 0 {
			query = query.Where("id NOT IN ?", recentCallerIDs)
		}
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	if req.IdsOnly {
		// 「选择全部结果」只取 ID；截断时由前端按 total 提示分批执行。
		var ids []int
		if err := query.Order("id asc").Limit(maxBatchUserIds).Pluck("id", &ids).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, gin.H{
			"ids":       ids,
			"total":     total,
			"truncated": total > int64(maxBatchUserIds),
		})
		return
	}

	page, pageSize := req.Page, req.PageSize
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	var users []model.User
	if err := query.Order("id asc").Offset((page - 1) * pageSize).Limit(pageSize).
		Find(&users).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	items := make([]UserFilterItem, 0, len(users))
	for _, user := range users {
		items = append(items, UserFilterItem{
			Id:          user.Id,
			Username:    user.Username,
			DisplayName: user.DisplayName,
			Role:        user.Role,
			Status:      user.Status,
			Quota:       user.Quota,
			UsedQuota:   user.UsedQuota,
			Group:       user.Group,
			LastLoginAt: user.LastLoginAt,
		})
	}
	if req.LastCallBefore != nil && len(items) > 0 {
		lastCallAt, err := lastConsumeTimes(items)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		for i := range items {
			items[i].LastCallAt = lastCallAt[items[i].Id]
		}
	}

	common.ApiSuccess(c, gin.H{
		"items":     items,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// BanUsersByIdsRequest 批量封禁请求；语义与 ManageUser 的 disable 动作一致。
type BanUsersByIdsRequest struct {
	Ids       []int  `json:"ids"`
	BanReason string `json:"ban_reason"`
}

// BanUsersByIds 逐用户执行与单独封禁相同的链路：禁用状态、提升 auth_version、
// 失效会话与令牌缓存。root 目标、操作者本人与无权管理的角色会被拒绝。
func BanUsersByIds(c *gin.Context) {
	var req BanUsersByIdsRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	ids := normalizeBatchIds(req.Ids)
	banReason := strings.TrimSpace(req.BanReason)
	if len(ids) == 0 || len(ids) > maxBatchUserIds || len(banReason) > 255 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	verificationMethod := "root_exempt"
	if !rootExemptFromProof(c, "ban_by_ids") {
		authorization := requireAdminUserProof(c, service.VerificationScopeAdminUserBanByIds,
			service.AdminUserBanByIdsContext{Ids: ids})
		if authorization == nil {
			return
		}
		verificationMethod = authorization.Method
	}

	operatorID, operatorRole := c.GetInt("id"), c.GetInt("role")
	banned := 0
	failures := make([]UserBatchFailure, 0)
	for _, id := range ids {
		target, err := model.GetUserById(id, false)
		if err != nil {
			failures = append(failures, UserBatchFailure{Id: id, Reason: batchFailureNotFound})
			continue
		}
		if target.Role == common.RoleRootUser || target.Id == operatorID {
			failures = append(failures, UserBatchFailure{Id: id, Reason: batchFailureForbidden})
			continue
		}
		if !canManageTargetRole(operatorRole, target.Role) {
			failures = append(failures, UserBatchFailure{Id: id, Reason: batchFailurePermission})
			continue
		}
		if target.Status == common.UserStatusDisabled {
			banned++
			continue
		}
		target.Status = common.UserStatusDisabled
		target.BanReason = banReason
		if err := target.Update(false); err != nil {
			failures = append(failures, UserBatchFailure{Id: id, Reason: batchFailureDatabase})
			common.SysLog("failed to disable user in batch: " + err.Error())
			continue
		}
		if err := model.InvalidateUserTokensCache(id); err != nil {
			common.SysLog("failed to invalidate tokens cache after batch disable: " + err.Error())
		}
		banned++
	}

	recordManageAuditFor(c, 0, "user.ban_by_ids", map[string]any{
		"requested":           len(ids),
		"banned":              banned,
		"failed":              len(failures),
		"ban_reason":          banReason,
		"verification_method": verificationMethod,
	})
	common.ApiSuccess(c, gin.H{"banned": banned, "failed": failures})
}

// BatchQuotaRequest 批量额度调整请求。Direction 为 add/subtract；Mode 为
// ratio（按每个用户当前额度的绝对值 × Ratio）或 fixed（所有用户相同的 Value）。
type BatchQuotaRequest struct {
	Ids       []int   `json:"ids"`
	Direction string  `json:"direction"`
	Mode      string  `json:"mode"`
	Ratio     float64 `json:"ratio"`
	Value     int     `json:"value"`
}

// BatchAdjustUserQuota 逐用户调用 model.AdjustUserQuota（事务 + 行锁 + 角色
// 校验 + 额度上下限 + 缓存同步），并为每个成功用户补 topup 日志与结构化审计，
// 与单用户 add_quota 的账务可见性保持一致。
func BatchAdjustUserQuota(c *gin.Context) {
	var req BatchQuotaRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	ids := normalizeBatchIds(req.Ids)
	if len(ids) == 0 || len(ids) > maxBatchUserIds {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if req.Direction != "add" && req.Direction != "subtract" {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	switch req.Mode {
	case "ratio":
		// NaN/Inf 会让 decimal.NewFromFloat panic，必须先校验有限性。
		if math.IsNaN(req.Ratio) || math.IsInf(req.Ratio, 0) || req.Ratio <= 0 || req.Ratio > maxQuotaRatio {
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
			return
		}
	case "fixed":
		if req.Value <= 0 || req.Value > common.MaxWalletQuota {
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
			return
		}
	default:
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	operatorID, operatorRole := c.GetInt("id"), c.GetInt("role")
	succeeded := 0
	failures := make([]UserBatchFailure, 0)
	for _, id := range ids {
		target, err := model.GetUserById(id, false)
		if err != nil {
			failures = append(failures, UserBatchFailure{Id: id, Reason: batchFailureNotFound})
			continue
		}
		if target.Role == common.RoleRootUser || target.Id == operatorID {
			failures = append(failures, UserBatchFailure{Id: id, Reason: batchFailureForbidden})
			continue
		}
		if !canManageTargetRole(operatorRole, target.Role) {
			failures = append(failures, UserBatchFailure{Id: id, Reason: batchFailurePermission})
			continue
		}

		// 倍率按每个用户当前额度的绝对值分别计算，由服务端完成取整。
		amount := req.Value
		if req.Mode == "ratio" {
			quota := int64(target.Quota)
			if quota < 0 {
				quota = -quota
			}
			delta, err := common.WalletQuotaFromDecimalStrict(
				decimal.NewFromInt(quota).Mul(decimal.NewFromFloat(req.Ratio)))
			if err != nil {
				failures = append(failures, UserBatchFailure{Id: id, Reason: batchFailureQuotaLimit})
				continue
			}
			if delta == 0 {
				failures = append(failures, UserBatchFailure{Id: id, Reason: batchFailureRatioTooSmall})
				continue
			}
			amount = delta
		}

		adjustment, err := model.AdjustUserQuota(id, operatorRole, req.Direction, amount)
		if err != nil {
			failures = append(failures, UserBatchFailure{Id: id, Reason: batchQuotaFailureReason(err)})
			continue
		}
		recordBatchQuotaAuditLog(c, req, adjustment, amount)
		succeeded++
	}

	recordManageAuditFor(c, 0, "user.batch_quota", map[string]any{
		"requested":        len(ids),
		"succeeded":        succeeded,
		"failed":           len(failures),
		"direction":        req.Direction,
		"adjustment_mode":  req.Mode,
		"ratio":            req.Ratio,
		"adjustment_value": req.Value,
	})
	common.ApiSuccess(c, gin.H{"succeeded": succeeded, "failed": failures})
}

// normalizeBatchIds 对批量用户 ID 排序去重；保持稳定顺序便于审计与凭证绑定。
func normalizeBatchIds(ids []int) []int {
	normalized := make([]int, 0, len(ids))
	for _, id := range ids {
		if id > 0 {
			normalized = append(normalized, id)
		}
	}
	slices.Sort(normalized)
	compacted := normalized[:0]
	for i, id := range normalized {
		if i == 0 || id != normalized[i-1] {
			compacted = append(compacted, id)
		}
	}
	return compacted
}

// batchQuotaFailureReason 把模型层的额度调整错误映射为稳定的失败原因。
func batchQuotaFailureReason(err error) string {
	switch {
	case errors.Is(err, model.ErrInvalidUserQuotaAdjustment):
		return batchFailureInvalidParams
	case errors.Is(err, model.ErrUserQuotaPermission):
		return batchFailurePermission
	case errors.Is(err, gorm.ErrRecordNotFound):
		return batchFailureNotFound
	case errors.Is(err, model.ErrWalletQuotaLimitExceeded):
		return batchFailureQuotaLimit
	default:
		common.SysLog("batch quota adjustment failed: " + err.Error())
		return batchFailureDatabase
	}
}

// recordBatchQuotaAuditLog 为单个成功用户写 topup 日志与结构化审计，字段与
// manageUserQuota 保持一致，使用户账务与审计都能看到本次变动。
func recordBatchQuotaAuditLog(c *gin.Context, req BatchQuotaRequest, adjustment *model.UserQuotaAdjustment, amount int) {
	action := "user.quota_add"
	if req.Direction == "subtract" {
		action = "user.quota_subtract"
	}
	params := model.AuditFields{
		"target_user_id":  adjustment.UserID,
		"target_username": adjustment.Username,
		"mode":            req.Direction,
		"requested_quota": amount,
		"quota":           amount,
		"from":            adjustment.Before,
		"to":              adjustment.After,
	}
	content := auditContentEN(action, params)
	model.RecordOperationAuditLog(c.GetInt("id"), c.GetInt("role"), content, c.ClientIP(), action, params,
		auditOperatorInfo(c), &model.AuditRequestInfo{
			Method: c.Request.Method, Route: c.FullPath(), Status: http.StatusOK, Success: true,
		}, c)
	model.RecordLogWithAdminInfo(adjustment.UserID, model.LogTypeTopup, content,
		auditOperatorInfo(c), &model.AuditOperation{Action: action, Params: params}, c)
}

// lastConsumeTimes 查询给定用户最近一次消费日志时间；无调用记录的用户不在结果中。
func lastConsumeTimes(items []UserFilterItem) (map[int]int64, error) {
	ids := make([]int, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.Id)
	}
	var rows []struct {
		UserId     int
		LastCallAt int64
	}
	if err := model.LOG_DB.Model(&model.Log{}).
		Select("user_id, MAX(created_at) AS last_call_at").
		Where("user_id IN ?", ids).
		Where("type = ?", model.LogTypeConsume).
		Group("user_id").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	times := make(map[int]int64, len(rows))
	for _, row := range rows {
		times[row.UserId] = row.LastCallAt
	}
	return times, nil
}
