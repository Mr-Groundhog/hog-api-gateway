package controller

import (
	"errors"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/coincapture"
	"github.com/gin-gonic/gin"
)

func GetCoinCaptureStatus(c *gin.Context) {
	view, err := model.GetCoinCaptureToday(c.GetInt("id"), time.Now())
	if err != nil {
		common.SysError(common.LogText("coin capture status failed: %s", err.Error()))
		common.ApiErrorStatus(c, http.StatusServiceUnavailable, common.NewMessage("Failed to load the game"))
		return
	}
	common.ApiSuccess(c, view)
}

func GetCoinCaptureLeaderboard(c *gin.Context) {
	rounds, err := model.GetCoinCaptureLeaderboard()
	if err != nil {
		common.SysError(common.LogText("coin capture leaderboard failed: %s", err.Error()))
		common.ApiErrorStatus(c, http.StatusServiceUnavailable, common.NewMessage("Failed to load player rankings"))
		return
	}
	common.ApiSuccess(c, rounds)
}

func StartCoinCapture(c *gin.Context) {
	var body struct{}
	if err := common.DecodeJson(c.Request.Body, &body); err != nil {
		common.ApiError(c, common.NewMessage("Invalid game request"))
		return
	}
	view, err := model.StartCoinCaptureRound(c.GetInt("id"), time.Now())
	if err != nil {
		common.SysError(common.LogText("coin capture start failed: %s", err.Error()))
		common.ApiError(c, common.NewMessage("Failed to start the game"))
		return
	}
	common.ApiSuccess(c, view)
}

func SettleCoinCapture(c *gin.Context) {
	var body struct {
		RoundId   string                 `json:"round_id"`
		Movements []coincapture.Movement `json:"movements"`
	}
	if err := common.DecodeJson(c.Request.Body, &body); err != nil {
		common.ApiError(c, common.NewMessage("Invalid game request"))
		return
	}
	view, err := model.SettleCoinCaptureRound(c.GetInt("id"), body.RoundId, body.Movements, time.Now())
	if err != nil {
		if errors.Is(err, model.ErrCoinCaptureInput) || errors.Is(err, model.ErrCoinCaptureNotFound) || errors.Is(err, model.ErrCoinCaptureNotFinished) {
			common.ApiError(c, err)
			return
		}
		common.ApiError(c, common.NewMessage("Failed to settle the game; please retry"))
		return
	}
	common.ApiSuccess(c, view)
}
