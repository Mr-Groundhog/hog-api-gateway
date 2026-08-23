package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ProbeGuardLogUser is the collapsed administrator view for one user.
type ProbeGuardLogUser struct {
	UserId          int    `json:"user_id"`
	Username        string `json:"username"`
	RecordCount     int64  `json:"record_count"`
	DryRunCount     int64  `json:"dry_run_count"`
	TriggerCount    int    `json:"trigger_count"`
	MaxDistinct     int    `json:"max_distinct"`
	LatestModels    string `json:"latest_models"`
	LatestDistinct  int    `json:"latest_distinct"`
	LatestIp        string `json:"latest_ip"`
	LatestCreatedAt int64  `json:"latest_created_at"`
}

func applyProbeGuardLogFilters(query *gorm.DB, c *gin.Context) *gorm.DB {
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
	if action := strings.TrimSpace(c.Query("action")); action != "" {
		query = query.Where("action_taken = ?", action)
	}
	if keyword := strings.TrimSpace(c.Query("keyword")); keyword != "" {
		pattern := "%" + keyword + "%"
		if userId, err := strconv.Atoi(keyword); err == nil && userId > 0 {
			query = query.Where("(user_id = ? OR username LIKE ? OR models_tested LIKE ?)", userId, pattern, pattern)
		} else {
			query = query.Where("(username LIKE ? OR models_tested LIKE ?)", pattern, pattern)
		}
	}
	if startTime, err := strconv.ParseInt(c.Query("start_time"), 10, 64); err == nil && startTime > 0 {
		query = query.Where("created_at >= ?", startTime)
	}
	if endTime, err := strconv.ParseInt(c.Query("end_time"), 10, 64); err == nil && endTime > 0 {
		query = query.Where("created_at <= ?", endTime)
	}
	return query
}

// GetProbeGuardLogs returns paginated probe guard trigger records for administrators.
func GetProbeGuardLogs(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	query := applyProbeGuardLogFilters(model.DB.Model(&model.ProbeGuardLog{}), c).Order("created_at DESC, id DESC")
	var total int64
	if err := query.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var items []*model.ProbeGuardLog
	if err := query.Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Find(&items).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

// GetProbeGuardLogUsers returns one paginated summary row per user.
func GetProbeGuardLogUsers(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	baseQuery := applyProbeGuardLogFilters(model.DB.Model(&model.ProbeGuardLog{}), c)
	var total int64
	groupedQuery := baseQuery.Select("user_id, username").Group("user_id, username")
	if err := model.DB.Table("(?) AS probe_guard_users", groupedQuery).Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var items []ProbeGuardLogUser
	query := baseQuery.Select("user_id, username, COUNT(*) AS record_count, " +
		"SUM(CASE WHEN action_taken = 'dry_run' THEN 1 ELSE 0 END) AS dry_run_count, " +
		"MAX(trigger_count) AS trigger_count, MAX(distinct_count) AS max_distinct, MAX(created_at) AS latest_created_at").
		Group("user_id, username").Order("latest_created_at DESC")
	if err := query.Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Scan(&items).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	attachProbeGuardLatestRecords(c, items)
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

// attachProbeGuardLatestRecords 为聚合行补充每个用户最近一条触发记录的模型清单，
// MAX(id) GROUP BY user_id 的子查询在 SQLite/MySQL/PostgreSQL 下行为一致。
func attachProbeGuardLatestRecords(c *gin.Context, items []ProbeGuardLogUser) {
	if len(items) == 0 {
		return
	}
	userIds := make([]int, 0, len(items))
	for _, item := range items {
		userIds = append(userIds, item.UserId)
	}
	latestSub := applyProbeGuardLogFilters(model.DB.Model(&model.ProbeGuardLog{}), c).
		Select("MAX(id) AS id").
		Where("user_id IN ?", userIds).
		Group("user_id")
	var latestLogs []model.ProbeGuardLog
	if err := model.DB.Where("id IN (?)", latestSub).Find(&latestLogs).Error; err != nil {
		common.SysError(fmt.Sprintf("probe guard latest records query failed: %v", err))
		return
	}
	latestByUser := make(map[int]*model.ProbeGuardLog, len(latestLogs))
	for i := range latestLogs {
		latestByUser[latestLogs[i].UserId] = &latestLogs[i]
	}
	for i := range items {
		if latest, ok := latestByUser[items[i].UserId]; ok {
			items[i].LatestModels = latest.ModelsTested
			items[i].LatestDistinct = latest.DistinctCount
			items[i].LatestIp = latest.Ip
		}
	}
}

// DeleteProbeGuardLogs permanently removes selected probe guard records.
func DeleteProbeGuardLogs(c *gin.Context) {
	var req struct {
		Ids        []int  `json:"ids"`
		Days       int    `json:"days"`
		BeforeTime int64  `json:"before_time"`
		Action     string `json:"action"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid delete cutoff"})
		return
	}
	if req.Action != "" && req.Action != model.ProbeGuardActionWarning &&
		req.Action != model.ProbeGuardActionBanned && req.Action != model.ProbeGuardActionDryRun {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid action"})
		return
	}
	for _, id := range req.Ids {
		if id <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid record id"})
			return
		}
	}
	query := model.DB
	switch {
	case len(req.Ids) > 0:
		query = query.Where("id IN ?", req.Ids)
	case req.BeforeTime > 0:
		query = query.Where("created_at < ?", req.BeforeTime)
	case req.Days > 0:
		if req.Days > 36500 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "days must be between 1 and 36500"})
			return
		}
		cutoff := time.Now().Add(-time.Duration(req.Days) * 24 * time.Hour).Unix()
		query = query.Where("created_at < ?", cutoff)
	case req.Action != "":
		// 仅按 action 清理（例如校准结束后清空全部 dry_run 记录）
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "at least one record must be selected"})
		return
	}
	if req.Action != "" && len(req.Ids) == 0 {
		query = query.Where("action_taken = ?", req.Action)
	}
	result := query.Delete(&model.ProbeGuardLog{})
	if result.Error != nil {
		common.ApiError(c, result.Error)
		return
	}
	common.ApiSuccess(c, gin.H{"deleted": result.RowsAffected})
}

// BanProbeGuardUser disables the user associated with probe guard records using the existing user status mechanism.
func BanProbeGuardUser(c *gin.Context) {
	var req struct {
		UserId int `json:"user_id" binding:"required"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.UserId <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid user_id"})
		return
	}
	if err := model.DB.Model(&model.User{}).Where("id = ?", req.UserId).Updates(map[string]interface{}{
		"status":     common.UserStatusDisabled,
		"ban_reason": model.UserBanReasonBatchModelProbing,
	}).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	_ = model.InvalidateUserTokensCache(req.UserId)
	common.ApiSuccess(c, nil)
}

// ResetProbeGuardCount clears the user's cumulative probe guard trigger count.
func ResetProbeGuardCount(c *gin.Context) {
	var req struct {
		UserId int `json:"user_id" binding:"required"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.UserId <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid user_id"})
		return
	}
	if err := model.ResetProbeGuardTriggerCount(req.UserId); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
