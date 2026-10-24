package controller

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func applyAIReviewFilters(query *gorm.DB, c *gin.Context) *gorm.DB {
	if user := strings.TrimSpace(c.Query("user")); user != "" {
		pattern := "%" + user + "%"
		if userId, err := strconv.Atoi(user); err == nil && userId > 0 {
			query = query.Where("(user_id = ? OR username LIKE ?)", userId, pattern)
		} else {
			query = query.Where("username LIKE ?", pattern)
		}
	}
	if verdict := strings.TrimSpace(c.Query("verdict")); verdict != "" {
		query = query.Where("verdict = ?", verdict)
	}
	if source := strings.TrimSpace(c.Query("source")); source != "" {
		query = query.Where("source = ?", source)
	}
	if category := strings.TrimSpace(c.Query("category")); category != "" {
		query = query.Where("category = ?", category)
	}
	if status, err := strconv.Atoi(c.Query("admin_status")); err == nil && status >= 0 {
		query = query.Where("admin_status = ?", status)
	}
	if startTime, err := strconv.ParseInt(c.Query("start_time"), 10, 64); err == nil && startTime > 0 {
		query = query.Where("created_at >= ?", startTime)
	}
	if endTime, err := strconv.ParseInt(c.Query("end_time"), 10, 64); err == nil && endTime > 0 {
		query = query.Where("created_at <= ?", endTime)
	}
	return query
}

// GetAIReviewRecords returns paginated AI review records for administrators.
func GetAIReviewRecords(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	query := applyAIReviewFilters(model.DB.Model(&model.AIReviewRecord{}), c).Order("created_at DESC, id DESC")
	var total int64
	if err := query.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var items []*model.AIReviewRecord
	if err := query.Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Find(&items).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

// GetAIReviewRecordStats returns review counters grouped by verdict and handling
// state, plus runtime queue observations. The pending count only includes
// flagged-but-unhandled records so mass false positives cannot flood the queue.
func GetAIReviewRecordStats(c *gin.Context) {
	var rows []struct {
		Verdict     string `json:"verdict"`
		AdminStatus int    `json:"admin_status"`
		Count       int64  `json:"count"`
	}
	if err := model.DB.Model(&model.AIReviewRecord{}).
		Select("verdict, admin_status, COUNT(*) AS count").
		Group("verdict, admin_status").Scan(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	counts := gin.H{}
	for _, row := range rows {
		key := row.Verdict + "_" + strconv.Itoa(row.AdminStatus)
		counts[key] = row.Count
	}
	queueLength, droppedTotal, processedTotal, flaggedTotal, autoBannedTotal := service.AIReviewRuntimeStats()
	common.ApiSuccess(c, gin.H{
		"counts":            counts,
		"queue_length":      queueLength,
		"dropped_total":     droppedTotal,
		"processed_total":   processedTotal,
		"flagged_total":     flaggedTotal,
		"auto_banned_total": autoBannedTotal,
	})
}

// HandleAIReviewRecord records an administrator decision on one AI review record.
// Actions: confirm (violation stands), dismiss (false positive), warn (confirm and
// notify the user), ban (confirm and disable the user).
func HandleAIReviewRecord(c *gin.Context) {
	var req struct {
		Id      int    `json:"id"`
		Action  string `json:"action"`
		Comment string `json:"comment"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.Id <= 0 {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid review id"))
		return
	}
	comment := strings.TrimSpace(req.Comment)
	if runes := []rune(comment); len(runes) > 1000 {
		comment = string(runes[:1000])
	}

	var record model.AIReviewRecord
	if err := model.DB.First(&record, req.Id).Error; err != nil {
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Review record not found"))
		return
	}

	var status int
	var actionTaken = "none"
	switch req.Action {
	case "confirm", "dismiss":
		if req.Action == "confirm" {
			status = model.AIReviewStatusConfirmed
		} else {
			status = model.AIReviewStatusDismissed
		}
	case "warn":
		status = model.AIReviewStatusConfirmed
		actionTaken = "warned"
	case "ban":
		status = model.AIReviewStatusConfirmed
		actionTaken = "banned"
	default:
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid action"))
		return
	}

	// 处置动作先执行：封禁或警告失败时记录保持原状，管理员可重试。
	switch req.Action {
	case "warn":
		if err := sendAIReviewWarning(&record); err != nil {
			common.ApiError(c, err)
			return
		}
	case "ban":
		if err := service.BanUserForAIReviewViolation(record.UserId); err != nil {
			common.ApiError(c, err)
			return
		}
	}

	updates := map[string]interface{}{
		"admin_status":   status,
		"admin_id":       c.GetInt("id"),
		"admin_username": c.GetString("username"),
		"admin_comment":  comment,
		"action_taken":   actionTaken,
		"handled_at":     time.Now().Unix(),
	}
	if err := model.DB.Model(&model.AIReviewRecord{}).Where("id = ?", req.Id).Updates(updates).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// sendAIReviewWarning notifies the offending user in their saved language.
func sendAIReviewWarning(record *model.AIReviewRecord) error {
	user, err := model.GetUserById(record.UserId, true)
	if err != nil || user == nil {
		return err
	}
	if user.Email == "" {
		return common.NewMessage("The user has no email address; warning notification was not sent")
	}
	userSetting := user.GetSetting()
	lang := userSetting.Language
	params := map[string]any{"Reason": record.Reason}
	return service.NotifyUser(user.Id, user.Email, userSetting, dto.NewNotify("ai_review_warn",
		i18n.Translate(lang, i18n.MsgAIReviewWarnSubject, params),
		i18n.Translate(lang, i18n.MsgAIReviewWarnContent, params), nil))
}

// DeleteAIReviewRecords permanently removes selected records or records older
// than the requested cutoff.
func DeleteAIReviewRecords(c *gin.Context) {
	var req struct {
		Ids        []int `json:"ids"`
		Days       int   `json:"days"`
		BeforeTime int64 `json:"before_time"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid delete cutoff"))
		return
	}
	if len(req.Ids) == 0 && req.BeforeTime <= 0 && req.Days <= 0 {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("At least one record must be selected"))
		return
	}
	for _, id := range req.Ids {
		if id <= 0 {
			common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid record id"))
			return
		}
	}
	if len(req.Ids) > 0 {
		result := model.DB.Where("id IN ?", req.Ids).Delete(&model.AIReviewRecord{})
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
			common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Days must be between 1 and 36500"))
			return
		}
		cutoff = time.Now().Add(-time.Duration(req.Days) * 24 * time.Hour).Unix()
	}
	if cutoff <= 0 {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Days must be between 1 and 36500"))
		return
	}
	result := model.DB.Where("created_at < ?", cutoff).Delete(&model.AIReviewRecord{})
	if result.Error != nil {
		common.ApiError(c, result.Error)
		return
	}
	common.ApiSuccess(c, gin.H{"deleted": result.RowsAffected})
}
