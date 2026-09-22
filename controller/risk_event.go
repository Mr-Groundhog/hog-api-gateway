package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/risk_setting"

	"github.com/gin-gonic/gin"
)

// GetTokenRiskUserSummaries 返回按用户聚合的疑似分发用户分页列表（管理员）。
func GetTokenRiskUserSummaries(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	filter := model.TokenRiskEventFilter{
		EventType: c.Query("event_type"),
	}
	if status, err := strconv.Atoi(c.Query("status")); err == nil && status >= 0 {
		filter.Status = &status
	}
	items, total, err := model.GetTokenRiskUserSummaries(filter, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

// tokenDistributionBanReason 是风控封禁写入的自定义原因文本。按运营约定
// 直接沿用"自定义原因"形式（自由文本，非机器枚举串），在前端用户详情中
// 原样展示，不经过 USER_BAN_REASON_LABEL_KEYS 的枚举映射。
const tokenDistributionBanReason = "涉嫌分发"

// BanTokenRiskUser 封禁疑似分发用户：复用现有用户状态机制并使其令牌缓存失效。
func BanTokenRiskUser(c *gin.Context) {
	var request struct {
		UserId int `json:"user_id" binding:"required"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || request.UserId <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid user_id"})
		return
	}
	if err := model.DB.Model(&model.User{}).Where("id = ?", request.UserId).Updates(map[string]any{
		"status":     common.UserStatusDisabled,
		"ban_reason": tokenDistributionBanReason,
	}).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	_ = model.InvalidateUserTokensCache(request.UserId)
	common.ApiSuccess(c, nil)
}

// DeleteTokenRiskEvents 按用户 ID 批量删除风控事件（管理员）。
// 请求体 { "user_ids": [2, 4] }，返回实际删除的事件行数。
func DeleteTokenRiskEvents(c *gin.Context) {
	var request struct {
		UserIds []int `json:"user_ids"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || len(request.UserIds) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid user_ids"})
		return
	}
	deleted, err := model.DeleteTokenRiskEventsByUserIds(request.UserIds)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"deleted": deleted})
}

// GetTokenRiskEvents 返回分页的风控事件列表（管理员），支持按状态/类型/用户/令牌过滤。
func GetTokenRiskEvents(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	filter := model.TokenRiskEventFilter{
		EventType: c.Query("event_type"),
	}
	if status, err := strconv.Atoi(c.Query("status")); err == nil && status >= 0 {
		filter.Status = &status
	}
	if userId, err := strconv.Atoi(c.Query("user_id")); err == nil && userId > 0 {
		filter.UserId = &userId
	}
	if tokenId, err := strconv.Atoi(c.Query("token_id")); err == nil && tokenId > 0 {
		filter.TokenId = &tokenId
	}
	events, total, err := model.GetTokenRiskEvents(filter, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(events)
	common.ApiSuccess(c, pageInfo)
}

// UpdateTokenRiskEventStatus 更新风控事件的处理状态（忽略/恢复）。
func UpdateTokenRiskEventStatus(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "invalid event id")
		return
	}
	var request struct {
		Status int `json:"status"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	if request.Status != risk_setting.RiskEventStatusPending && request.Status != risk_setting.RiskEventStatusIgnored {
		common.ApiErrorMsg(c, "invalid status")
		return
	}
	if err := model.UpdateTokenRiskEventStatus(id, request.Status); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
