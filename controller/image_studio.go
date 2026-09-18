package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
)

func GetImageStudioUsage(c *gin.Context) {
	used, err := model.GetTodayImageStudioUsage(c.GetInt("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to load image generation usage"})
		return
	}

	limit := setting.ImageStudioDailyLimit
	remaining := 0
	if limit > 0 {
		remaining = max(limit-used, 0)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{"used": used, "limit": limit, "remaining": remaining, "unlimited": limit == 0},
	})
}
