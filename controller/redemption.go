package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

func GetAllRedemptions(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	redemptions, total, err := model.GetAllRedemptions(pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(redemptions)
	common.ApiSuccess(c, pageInfo)
	return
}

func SearchRedemptions(c *gin.Context) {
	keyword := c.Query("keyword")
	status := c.Query("status")
	pageInfo := common.GetPageQuery(c)
	redemptions, total, err := model.SearchRedemptions(keyword, status, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(redemptions)
	common.ApiSuccess(c, pageInfo)
	return
}

func GetRedemption(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	redemption, err := model.GetRedemptionById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    redemption,
	})
	return
}

func AddRedemption(c *gin.Context) {
	if !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiErrorT(c, "Payment, redemption, subscription, and invitation reward features are disabled. The administrator must confirm compliance terms before enabling them.")
		return
	}

	redemption := model.Redemption{}
	err := c.ShouldBindJSON(&redemption)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if utf8.RuneCountInString(redemption.Name) == 0 || utf8.RuneCountInString(redemption.Name) > common.MaxRedemptionNameLength {
		common.ApiErrorI18n(c, i18n.MsgRedemptionNameLength)
		return
	}
	if redemption.Count <= 0 {
		common.ApiErrorT(c, "Redemption code count must be greater than 0")
		return
	}
	if redemption.Count > 100 {
		common.ApiErrorT(c, "Maximum 100 redemption codes can be generated at once")
		return
	}
	if redemption.Quota <= 0 {
		common.ApiErrorT(c, "Redemption quota must be positive")
		return
	}
	if err := common.ValidateWalletQuota(redemption.Quota); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := validateExpiredTime(redemption.ExpiredTime); err != nil {
		common.ApiError(c, err)
		return
	}
	if redemption.ValidUntil < 0 {
		common.ApiError(c, fmt.Errorf("valid_until must not be negative"))
		return
	}
	redemption.AirdropGroup = strings.TrimSpace(redemption.AirdropGroup)
	redemption.AirdropBatchId = strings.TrimSpace(redemption.AirdropBatchId)
	if redemption.IsAirdrop {
		if redemption.AirdropBatchId == "" {
			redemption.AirdropBatchId = common.GetUUID()
		}
		if redemption.ValidUntil == 0 || redemption.ValidUntil < common.GetTimestamp() {
			common.ApiError(c, fmt.Errorf("valid_until must be a future timestamp for airdrop codes"))
			return
		}
		redemption.ExpiredTime = redemption.ValidUntil
	} else {
		redemption.AirdropGroup = ""
		redemption.AirdropBatchId = ""
		redemption.ValidUntil = 0
	}
	var keys []string
	for i := 0; i < redemption.Count; i++ {
		key := common.GetUUID()
		cleanRedemption := model.Redemption{
			UserId:         c.GetInt("id"),
			Name:           redemption.Name,
			Key:            key,
			CreatedTime:    common.GetTimestamp(),
			Quota:          redemption.Quota,
			ExpiredTime:    redemption.ExpiredTime,
			IsAirdrop:      redemption.IsAirdrop,
			AirdropGroup:   redemption.AirdropGroup,
			AirdropBatchId: redemption.AirdropBatchId,
			ValidUntil:     redemption.ValidUntil,
		}
		err = cleanRedemption.Insert()
		if err != nil {
			common.SysError(common.LogText("failed to insert redemption: %s", err.Error()))
			common.ApiErrorStatus(c, http.StatusOK, common.NewMessage("Failed to create redemption code, please try again later"), gin.H{"data": keys})
			return
		}
		keys = append(keys, key)
	}
	if redemption.IsAirdrop {
		if err := model.SyncWelfareAirdropStockForBatch(
			redemption.AirdropBatchId, redemption.Name, redemption.Quota,
			redemption.Count, redemption.ValidUntil, c.GetInt("id"), common.GetTimestamp(),
		); err != nil {
			common.SysError("failed to sync welfare airdrop stock: " + err.Error())
		}
	}
	recordManageAudit(c, "redemption.create", map[string]any{
		"name":             redemption.Name,
		"count":            redemption.Count,
		"quota":            logger.FormatQuota(redemption.Quota),
		"is_airdrop":       redemption.IsAirdrop,
		"airdrop_group":    redemption.AirdropGroup,
		"airdrop_batch_id": redemption.AirdropBatchId,
		"valid_until":      redemption.ValidUntil,
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    keys,
	})
	return
}

func DeleteRedemption(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	redemption, err := model.GetRedemptionById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	err = model.DeleteRedemptionById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 删除的是尚未使用的空投码时，同步释放批次活动的库存，避免幽灵库存。
	if redemption.IsAirdrop && redemption.Status == common.RedemptionCodeStatusEnabled {
		if err := model.AdjustWelfareAirdropStockForBatch(redemption.AirdropBatchId, -1, common.GetTimestamp()); err != nil {
			common.SysError("failed to adjust welfare airdrop stock on delete: " + err.Error())
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func UpdateRedemption(c *gin.Context) {
	statusOnly := c.Query("status_only")
	redemption := model.Redemption{}
	err := c.ShouldBindJSON(&redemption)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	cleanRedemption, err := model.GetRedemptionById(redemption.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if statusOnly == "" {
		if redemption.Quota <= 0 {
			common.ApiErrorT(c, "Redemption quota must be positive")
			return
		}
		if err := common.ValidateWalletQuota(redemption.Quota); err != nil {
			common.ApiError(c, err)
			return
		}
		if err := validateExpiredTime(redemption.ExpiredTime); err != nil {
			common.ApiError(c, err)
			return
		}
		// If you add more fields, please also update redemption.Update()
		cleanRedemption.Name = redemption.Name
		cleanRedemption.Quota = redemption.Quota
		cleanRedemption.ExpiredTime = redemption.ExpiredTime
	}
	if statusOnly != "" {
		// 停用/启用尚未使用的空投码时同步增减批次活动库存（已使用的码状态为
		// used，不经过这里），保证剩余可领取数与实际可用码数一致。
		if cleanRedemption.IsAirdrop &&
			cleanRedemption.Status != redemption.Status &&
			(cleanRedemption.Status == common.RedemptionCodeStatusEnabled ||
				redemption.Status == common.RedemptionCodeStatusEnabled) {
			delta := 1
			if redemption.Status != common.RedemptionCodeStatusEnabled {
				delta = -1
			}
			if err := model.AdjustWelfareAirdropStockForBatch(cleanRedemption.AirdropBatchId, delta, common.GetTimestamp()); err != nil {
				common.SysError("failed to adjust welfare airdrop stock on status change: " + err.Error())
			}
		}
		cleanRedemption.Status = redemption.Status
	}
	err = cleanRedemption.Update()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    cleanRedemption,
	})
	return
}

func DeleteInvalidRedemption(c *gin.Context) {
	now := common.GetTimestamp()
	// 清理的无效码里「已过期未使用」的空投码还占着活动库存，先按批次统计并在
	// 删除成功后释放，避免用户端看到永远领不到的幽灵库存。
	expiredAirdropCounts, err := model.ExpiredUnusedAirdropBatchCounts(now)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	rows, err := model.DeleteInvalidRedemptions()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	for batchId, count := range expiredAirdropCounts {
		if err := model.AdjustWelfareAirdropStockForBatch(batchId, -count, now); err != nil {
			common.SysError("failed to release welfare airdrop stock for batch " + batchId + ": " + err.Error())
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    rows,
	})
	return
}

func validateExpiredTime(expired int64) error {
	if expired != 0 && expired < common.GetTimestamp() {
		return common.NewMessage("Expiration time cannot be earlier than current time")
	}
	return nil
}

func DeleteRedemptionBatch(c *gin.Context) {
	var request struct {
		Ids []int `json:"ids" binding:"required,min=1,max=1000,dive,gt=0"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	count, err := model.BatchDeleteRedemptions(request.Ids)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "redemption.delete_batch", map[string]any{
		"count":                    count,
		"total":                    len(request.Ids),
		"requested_redemption_ids": request.Ids,
	})
	common.ApiSuccess(c, count)
}
