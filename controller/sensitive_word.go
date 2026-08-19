package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// GetSensitiveWordViolations returns paginated sensitive-word violation records for administrators.
func GetSensitiveWordViolations(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	query := model.DB.Model(&model.SensitiveWordViolation{}).Order("created_at DESC, id DESC")
	if userId, err := strconv.Atoi(c.Query("user_id")); err == nil && userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	if user := strings.TrimSpace(c.Query("user")); user != "" {
		if userId, err := strconv.Atoi(user); err == nil && userId > 0 {
			query = query.Where("(user_id = ? OR username LIKE ?)", userId, "%"+user+"%")
		} else {
			query = query.Where("username LIKE ?", "%"+user+"%")
		}
	}
	if ip := c.Query("ip"); ip != "" {
		query = query.Where("ip = ?", ip)
	}
	if startTime, err := strconv.ParseInt(c.Query("start_time"), 10, 64); err == nil && startTime > 0 {
		query = query.Where("created_at >= ?", startTime)
	}
	if endTime, err := strconv.ParseInt(c.Query("end_time"), 10, 64); err == nil && endTime > 0 {
		query = query.Where("created_at <= ?", endTime)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var items []*model.SensitiveWordViolation
	if err := query.Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Find(&items).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

// BanSensitiveWordViolationUser disables the user associated with a violation using the existing user status mechanism.
func BanSensitiveWordViolationUser(c *gin.Context) {
	var req struct {
		UserId int `json:"user_id" binding:"required"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.UserId <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid user_id"})
		return
	}
	if err := model.DB.Model(&model.User{}).Where("id = ?", req.UserId).Updates(map[string]interface{}{
		"status":     common.UserStatusDisabled,
		"ban_reason": model.UserBanReasonProhibitedWords,
	}).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	_ = model.InvalidateUserTokensCache(req.UserId)
	common.ApiSuccess(c, nil)
}
