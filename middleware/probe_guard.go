package middleware

import (
	"fmt"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

// ProbeGuard 检测短时间跨模型测活行为：按用户维度统计滑动窗口内请求过的去重模型数，
// 达到阈值后按配置执行警告或自动封禁。必须挂在 Distribute 之后，复用其写入的
// original_model，避免重复解析请求体。
func ProbeGuard() func(c *gin.Context) {
	return func(c *gin.Context) {
		settings := operation_setting.GetProbeGuardSettings()
		if !settings.Enabled && !settings.DryRun {
			c.Next()
			return
		}
		userId := common.GetContextKeyInt(c, constant.ContextKeyUserId)
		if userId <= 0 {
			c.Next()
			return
		}
		if common.GetContextKeyInt(c, constant.ContextKeyUserRole) >= common.RoleAdminUser {
			c.Next()
			return
		}
		group := common.GetContextKeyString(c, constant.ContextKeyTokenGroup)
		if group == "" {
			group = common.GetContextKeyString(c, constant.ContextKeyUserGroup)
		}
		if operation_setting.IsProbeGuardExempt(settings, userId, group) {
			c.Next()
			return
		}
		modelName := common.GetContextKeyString(c, constant.ContextKeyOriginalModel)
		if modelName == "" {
			c.Next()
			return
		}

		distinctModels, err := service.RecordProbeGuardModel(userId, modelName, settings.WindowSeconds)
		if err != nil {
			// 风控组件故障不应阻断正常转发
			common.SysError(fmt.Sprintf("probe guard window record failed for user %d: %v", userId, err))
			c.Next()
			return
		}
		if len(distinctModels) < settings.ModelThreshold {
			c.Next()
			return
		}

		entry := buildProbeGuardLogEntry(c, userId, settings, distinctModels)
		if settings.DryRun {
			// 观察模式同样按窗口合并只记一行，但不拦截、不计数
			if service.ClaimProbeGuardTrigger(userId, settings.WindowSeconds) {
				entry.ActionTaken = model.ProbeGuardActionDryRun
				recordProbeGuardEntryAsync(entry)
			}
			c.Next()
			return
		}

		if !service.ClaimProbeGuardTrigger(userId, settings.WindowSeconds) {
			// 同一冷却期内已记录过触发，只拦截不重复计数
			abortWithOpenAiMessage(c, http.StatusForbidden,
				common.TranslateMessage(c, i18n.MsgProbeGuardWarning), types.ErrorCodeBatchModelProbing)
			return
		}

		triggerCount, err := model.IncrementProbeGuardTriggerCount(userId)
		if err != nil {
			common.SysError(fmt.Sprintf("probe guard trigger increment failed for user %d: %v", userId, err))
			abortWithOpenAiMessage(c, http.StatusForbidden,
				common.TranslateMessage(c, i18n.MsgProbeGuardWarning), types.ErrorCodeBatchModelProbing)
			return
		}
		entry.TriggerCount = triggerCount

		if triggerCount >= settings.MaxTriggers {
			if banErr := service.BanUserForProbeGuard(userId); banErr != nil {
				common.SysError(fmt.Sprintf("probe guard ban failed for user %d: %v", userId, banErr))
				entry.ActionTaken = model.ProbeGuardActionWarning
				abortWithOpenAiMessage(c, http.StatusForbidden,
					common.TranslateMessage(c, i18n.MsgProbeGuardWarning), types.ErrorCodeBatchModelProbing)
			} else {
				entry.ActionTaken = model.ProbeGuardActionBanned
				abortWithOpenAiMessage(c, http.StatusForbidden,
					common.TranslateMessage(c, i18n.MsgProbeGuardBanned), types.ErrorCodeBatchModelProbing)
			}
		} else {
			entry.ActionTaken = model.ProbeGuardActionWarning
			abortWithOpenAiMessage(c, http.StatusForbidden,
				common.TranslateMessage(c, i18n.MsgProbeGuardWarning), types.ErrorCodeBatchModelProbing)
		}
		recordProbeGuardEntryAsync(entry)
	}
}

func buildProbeGuardLogEntry(c *gin.Context, userId int, settings *operation_setting.ProbeGuardSettings, distinctModels []string) *model.ProbeGuardLog {
	modelsJson, err := common.Marshal(distinctModels)
	if err != nil {
		common.SysError(fmt.Sprintf("probe guard marshal models failed for user %d: %v", userId, err))
		modelsJson = []byte("[]")
	}
	return &model.ProbeGuardLog{
		UserId:        userId,
		Username:      common.GetContextKeyString(c, constant.ContextKeyUserName),
		TokenId:       common.GetContextKeyInt(c, constant.ContextKeyTokenId),
		TokenName:     c.GetString("token_name"),
		Ip:            c.ClientIP(),
		UserAgent:     c.Request.UserAgent(),
		WindowSeconds: settings.WindowSeconds,
		ModelsTested:  string(modelsJson),
		DistinctCount: len(distinctModels),
	}
}

func recordProbeGuardEntryAsync(entry *model.ProbeGuardLog) {
	gopool.Go(func() {
		if err := model.RecordProbeGuardLog(entry); err != nil {
			common.SysError(fmt.Sprintf("probe guard log record failed for user %d: %v", entry.UserId, err))
		}
	})
}
