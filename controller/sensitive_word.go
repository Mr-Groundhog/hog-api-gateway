package controller

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// SensitiveWordViolationUser is the collapsed administrator view for one user.
type SensitiveWordViolationUser struct {
	UserId          int    `json:"user_id"`
	Username        string `json:"username"`
	ViolationCount  int64  `json:"violation_count"`
	TriggerCount    int    `json:"trigger_count"`
	Highlighted     bool   `json:"highlighted"`
	LatestCreatedAt int64  `json:"latest_created_at"`
}

func applySensitiveWordViolationFilters(query *gorm.DB, c *gin.Context) *gorm.DB {
	if user := strings.TrimSpace(c.Query("user")); user != "" {
		pattern := "%" + user + "%"
		if userId, err := strconv.Atoi(user); err == nil && userId > 0 {
			query = query.Where("(user_id = ? OR username LIKE ?)", userId, pattern)
		} else {
			query = query.Where("username LIKE ?", pattern)
		}
	}
	if userId, err := strconv.Atoi(c.Query("user_id")); err == nil && userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	if ip := c.Query("ip"); ip != "" {
		query = query.Where("ip = ?", ip)
	}
	if keyword := strings.TrimSpace(c.Query("keyword")); keyword != "" {
		pattern := "%" + keyword + "%"
		if userId, err := strconv.Atoi(keyword); err == nil && userId > 0 {
			query = query.Where("(user_id = ? OR username LIKE ? OR request_content LIKE ? OR matched_words LIKE ?)", userId, pattern, pattern, pattern)
		} else {
			query = query.Where("(username LIKE ? OR request_content LIKE ? OR matched_words LIKE ?)", pattern, pattern, pattern)
		}
	}
	if startTime, err := strconv.ParseInt(c.Query("start_time"), 10, 64); err == nil && startTime > 0 {
		query = query.Where("created_at >= ?", startTime)
	}
	if endTime, err := strconv.ParseInt(c.Query("end_time"), 10, 64); err == nil && endTime > 0 {
		query = query.Where("created_at <= ?", endTime)
	}
	if highlighted, err := strconv.ParseBool(c.Query("highlighted")); err == nil && highlighted {
		query = query.Where("(highlighted = ? OR trigger_count >= ?)", model.CommonTrueVal(), model.SensitiveWordHighlightThreshold)
	}
	return query
}

// GetSensitiveWordViolations returns paginated sensitive-word violation records for administrators.
func GetSensitiveWordViolations(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	query := applySensitiveWordViolationFilters(model.DB.Model(&model.SensitiveWordViolation{}), c).Order("created_at DESC, id DESC")
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
	for _, item := range items {
		item.Highlighted = item.TriggerCount >= model.SensitiveWordHighlightThreshold
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

// GetSensitiveWordViolationUsers returns one paginated summary row per user.
func GetSensitiveWordViolationUsers(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	baseQuery := applySensitiveWordViolationFilters(model.DB.Model(&model.SensitiveWordViolation{}), c)
	var total int64
	groupedQuery := baseQuery.Select("user_id, username").Group("user_id, username")
	if err := model.DB.Table("(?) AS sensitive_word_users", groupedQuery).Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var items []SensitiveWordViolationUser
	query := baseQuery.Select("user_id, username, COUNT(*) AS violation_count, MAX(trigger_count) AS trigger_count, MAX(created_at) AS latest_created_at").
		Group("user_id, username").Order("latest_created_at DESC")
	if err := query.Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Scan(&items).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	for i := range items {
		items[i].Highlighted = items[i].TriggerCount >= model.SensitiveWordHighlightThreshold
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

// DeleteSensitiveWordViolations permanently removes selected records older than the requested cutoff.
func DeleteSensitiveWordViolations(c *gin.Context) {
	var req struct {
		Ids        []int `json:"ids"`
		Days       int   `json:"days"`
		BeforeTime int64 `json:"before_time"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid delete cutoff"})
		return
	}
	if len(req.Ids) == 0 && req.BeforeTime <= 0 && req.Days <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "at least one record must be selected"})
		return
	}
	for _, id := range req.Ids {
		if id <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid record id"})
			return
		}
	}
	if len(req.Ids) > 0 {
		result := model.DB.Where("id IN ?", req.Ids).Delete(&model.SensitiveWordViolation{})
		if result.Error != nil {
			common.ApiError(c, result.Error)
			return
		}
		common.ApiSuccess(c, gin.H{"deleted": result.RowsAffected})
		return
	}
	cutoff := req.BeforeTime
	if cutoff <= 0 {
		if req.Days < 1 || req.Days > 36500 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "days must be between 1 and 36500"})
			return
		}
		cutoff = time.Now().Add(-time.Duration(req.Days) * 24 * time.Hour).Unix()
	}
	if cutoff <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "days must be between 1 and 36500"})
		return
	}
	result := model.DB.Where("created_at < ?", cutoff).Delete(&model.SensitiveWordViolation{})
	if result.Error != nil {
		common.ApiError(c, result.Error)
		return
	}
	common.ApiSuccess(c, gin.H{"deleted": result.RowsAffected})
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

// ResetSensitiveWordViolationCount clears the user's cumulative sensitive-word trigger count.
func ResetSensitiveWordViolationCount(c *gin.Context) {
	var req struct {
		UserId int `json:"user_id" binding:"required"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.UserId <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid user_id"})
		return
	}
	if err := model.ResetSensitiveWordTriggerCount(req.UserId); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
