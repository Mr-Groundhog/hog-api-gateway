package controller

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// welfareAirdropClaimErrorCodes 把领取失败的业务原因映射成前端可辨识的错误码，
// 前端据此决定是刷新列表（库存/时间窗口变化）还是仅提示（已达限次）。
var welfareAirdropClaimErrorCodes = []struct {
	err  error
	code string
}{
	{model.ErrWelfareAirdropNotFound, "WELFARE_AIRDROP_NOT_FOUND"},
	{model.ErrWelfareAirdropDisabled, "WELFARE_AIRDROP_DISABLED"},
	{model.ErrWelfareAirdropNotStarted, "WELFARE_AIRDROP_NOT_STARTED"},
	{model.ErrWelfareAirdropEnded, "WELFARE_AIRDROP_ENDED"},
	{model.ErrWelfareAirdropSoldOut, "WELFARE_AIRDROP_SOLD_OUT"},
	{model.ErrWelfareAirdropUserLimit, "WELFARE_AIRDROP_USER_LIMIT"},
	{model.ErrWelfareAirdropQuotaOverflow, "WELFARE_AIRDROP_QUOTA_OVERFLOW"},
}

// GetWelfareAirdrops returns the airdrop campaigns visible to the current user,
// each already annotated with whether this user can still claim it.
func GetWelfareAirdrops(c *gin.Context) {
	userId := c.GetInt("id")
	if userId == 0 {
		common.ApiError(c, errors.New("用户未登录"))
		return
	}

	airdrops, err := service.ListWelfareAirdropsForUser(userId, time.Now().Unix())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, airdrops)
}

// GetWelfareAirdropStatus returns the newest visible campaign for the compact airdrop API.
func GetWelfareAirdropStatus(c *gin.Context) {
	userId := c.GetInt("id")
	airdrops, err := service.ListWelfareAirdropsForUser(userId, time.Now().Unix())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(airdrops) == 0 {
		common.ApiSuccess(c, nil)
		return
	}
	campaign := airdrops[0]
	common.ApiSuccess(c, gin.H{
		"batch_id": campaign.BatchId, "batch_name": campaign.Name,
		"total_count": campaign.TotalCount, "claimed_count": campaign.ClaimedCount,
		"remain_count": campaign.Remaining, "quota": campaign.Quota,
		"valid_until": campaign.EndTime, "is_claimed_by_user": campaign.ClaimedByMe > 0,
	})
}

// ClaimWelfareAirdrop grants one share of an airdrop to the current user and
// returns the redemption code issued for that grant.
func ClaimWelfareAirdrop(c *gin.Context) {
	userId := c.GetInt("id")
	if userId == 0 {
		common.ApiError(c, errors.New("用户未登录"))
		return
	}
	airdropId, err := strconv.Atoi(c.Param("id"))
	if err != nil || airdropId <= 0 {
		var req struct {
			BatchId   string `json:"batch_id"`
			AirdropId int    `json:"airdrop_id"`
		}
		if decodeErr := common.DecodeJson(c.Request.Body, &req); decodeErr != nil {
			common.ApiErrorMsg(c, "无效的活动参数")
			return
		}
		if req.AirdropId > 0 {
			airdropId = req.AirdropId
		} else {
			airdrop, lookupErr := model.GetWelfareAirdropByBatchId(req.BatchId)
			if lookupErr != nil {
				common.ApiError(c, lookupErr)
				return
			}
			airdropId = airdrop.Id
		}
	}

	claim, err := service.ClaimWelfareAirdrop(airdropId, userId, time.Now().Unix())
	if err != nil {
		for _, mapping := range welfareAirdropClaimErrorCodes {
			if errors.Is(err, mapping.err) {
				c.JSON(http.StatusConflict, gin.H{
					"success": false,
					"code":    mapping.code,
					"message": mapping.err.Error(),
				})
				return
			}
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, claim)
}

// GetMyWelfareAirdropClaims returns the current user's most recent claim
// history (newest first, up to 10 records).
func GetMyWelfareAirdropClaims(c *gin.Context) {
	userId := c.GetInt("id")
	if userId == 0 {
		common.ApiError(c, errors.New("用户未登录"))
		return
	}

	claims, err := service.ListWelfareAirdropClaims(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, claims)
}

// GetAllWelfareAirdrops returns every campaign, including disabled and expired
// ones, for the admin management page.
func GetAllWelfareAirdrops(c *gin.Context) {
	airdrops, err := service.ListAllWelfareAirdrops()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, airdrops)
}

// AddWelfareAirdrop creates a new airdrop campaign.
func AddWelfareAirdrop(c *gin.Context) {
	var airdrop model.WelfareAirdrop
	if err := common.DecodeJson(c.Request.Body, &airdrop); err != nil {
		common.ApiErrorMsg(c, "无效的参数")
		return
	}
	if err := service.CreateWelfareAirdrop(&airdrop, c.GetInt("id"), time.Now().Unix()); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, airdrop)
}

// UpdateWelfareAirdrop saves changes to an existing airdrop campaign.
func UpdateWelfareAirdrop(c *gin.Context) {
	var airdrop model.WelfareAirdrop
	if err := common.DecodeJson(c.Request.Body, &airdrop); err != nil {
		common.ApiErrorMsg(c, "无效的参数")
		return
	}
	if airdrop.Id <= 0 {
		common.ApiErrorMsg(c, "缺少活动 ID")
		return
	}
	if err := service.UpdateWelfareAirdrop(&airdrop, time.Now().Unix()); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, airdrop)
}

// UpdateWelfareAirdropStatus toggles a campaign between enabled and disabled
// without touching other fields. Disabling is how an admin cancels an airdrop:
// users can no longer see or claim it, while already granted credits stay.
func UpdateWelfareAirdropStatus(c *gin.Context) {
	var req struct {
		Id     int `json:"id"`
		Status int `json:"status"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "无效的参数")
		return
	}
	if req.Id <= 0 {
		common.ApiErrorMsg(c, "缺少活动 ID")
		return
	}
	if err := model.UpdateWelfareAirdropStatus(req.Id, req.Status, time.Now().Unix()); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// DeleteWelfareAirdrop removes an airdrop campaign by its primary key. Existing
// claims and issued redemption codes are kept so past grants stay auditable.
func DeleteWelfareAirdrop(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "无效的活动 ID")
		return
	}
	if err := service.RemoveWelfareAirdrop(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
