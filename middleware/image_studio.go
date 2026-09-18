package middleware

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
)

func ImageStudioDailyLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		userId := c.GetInt("id")
		used, err := model.ReserveTodayImageStudioUsage(userId, setting.ImageStudioDailyLimit)
		if errors.Is(err, model.ErrImageStudioDailyLimitReached) {
			abortWithOpenAiMessage(c, http.StatusTooManyRequests, "Daily image generation limit reached")
			return
		}
		if err != nil {
			logger.LogError(c, "failed to reserve image studio daily usage: "+err.Error())
			abortWithOpenAiMessage(c, http.StatusInternalServerError, "Failed to update image generation usage")
			return
		}

		c.Header("X-Image-Studio-Used", strconv.Itoa(used))
		c.Next()
		if c.Writer.Status() < http.StatusBadRequest {
			return
		}
		if err := model.ReleaseTodayImageStudioUsage(userId); err != nil {
			logger.LogError(c, "failed to release image studio daily usage: "+err.Error())
		}
	}
}
