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

func DrawLottery(c *gin.Context) {
	userId := c.GetInt("id")
	username, err := model.GetUsernameById(userId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	result, err := service.DrawLottery(userId, username, time.Now())
	if errors.Is(err, service.ErrLotteryDailyLimitReached) {
		c.JSON(http.StatusConflict, gin.H{
			"success": false,
			"code":    "LOTTERY_DAILY_LIMIT_REACHED",
			"message": "今天已经抽过奖了",
		})
		return
	}
	if errors.Is(err, service.ErrLotteryNotConfigured) {
		c.JSON(http.StatusConflict, gin.H{
			"success": false,
			"code":    "LOTTERY_NOT_CONFIGURED",
			"message": "暂无可抽奖项",
		})
		return
	}
	if errors.Is(err, service.ErrLotteryQuotaOverflow) {
		c.JSON(http.StatusConflict, gin.H{
			"success": false,
			"code":    "LOTTERY_QUOTA_OVERFLOW",
			"message": "您的额度已接近上限，无法发放本次奖励，请先消耗部分额度后再试",
		})
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetTodayLotteryRecords(c *gin.Context) {
	records, err := service.GetTodayLotteryRecords(time.Now())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, records)
}

// GetLotteryStatus returns the current login user's remaining draw count for
// today, so the page can show the remaining count and disable the draw button
// when it reaches zero.
func GetLotteryStatus(c *gin.Context) {
	userId := c.GetInt("id")
	if userId == 0 {
		common.ApiError(c, errors.New("用户未登录"))
		return
	}

	now := time.Now()
	remaining, err := service.GetLotteryRemaining(userId, now)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	myDraw, err := service.GetTodayLotteryResult(userId, now)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	rank, err := service.GetTodayLotteryRank(userId, now)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{
		"remaining":   remaining,
		"daily_limit": service.LotteryDailyLimit,
		"my_draw":     myDraw,
		"rank":        rank,
	})
}

// GetMyLotteryRecords returns the current login user's own draw history.
func GetMyLotteryRecords(c *gin.Context) {
	userId := c.GetInt("id")
	if userId == 0 {
		common.ApiError(c, errors.New("用户未登录"))
		return
	}

	records, err := service.GetMyLotteryRecords(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, records)
}

// GetLotteryConfig returns the active prizes used to render the lottery board.
func GetLotteryConfig(c *gin.Context) {
	prizes, err := service.GetPublicLotteryPrizes()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, prizes)
}

// GetLotteryPrizes returns all prize configurations for the admin management
// page, including inactive ones.
func GetLotteryPrizes(c *gin.Context) {
	prizes, err := service.ListLotteryPrizes()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, prizes)
}

// CreateLotteryPrize adds a new prize configuration.
func CreateLotteryPrize(c *gin.Context) {
	var prize model.LotteryPrize
	if err := common.DecodeJson(c.Request.Body, &prize); err != nil {
		common.ApiErrorMsg(c, "无效的参数")
		return
	}
	if err := service.SaveLotteryPrize(&prize); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, prize)
}

// UpdateLotteryPrize saves changes to an existing prize configuration.
func UpdateLotteryPrize(c *gin.Context) {
	var prize model.LotteryPrize
	if err := common.DecodeJson(c.Request.Body, &prize); err != nil {
		common.ApiErrorMsg(c, "无效的参数")
		return
	}
	if prize.Id == 0 {
		common.ApiErrorMsg(c, "缺少奖项 ID")
		return
	}
	if err := service.SaveLotteryPrize(&prize); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, prize)
}

// DeleteLotteryPrize removes a prize configuration by its primary key.
func DeleteLotteryPrize(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "无效的奖项 ID")
		return
	}
	if err := service.RemoveLotteryPrize(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
