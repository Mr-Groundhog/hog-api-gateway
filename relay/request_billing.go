package relay

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

// PrepareRequestBilling estimates and reserves one request's charge. Transports
// provide the current request body through BodyStorage or BillingRequestInput;
// channel retries retain the resulting billing session and pricing snapshot.
func PrepareRequestBilling(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	// 敏感词检测按分组生效：自动分组优先，其次为当前使用分组。
	sensitiveCheckGroup := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	if autoGroup := common.GetContextKeyString(c, constant.ContextKeyAutoGroup); autoGroup != "" {
		sensitiveCheckGroup = autoGroup
	}
	needSensitiveCheck := setting.ShouldCheckPromptSensitiveForGroup(sensitiveCheckGroup)
	meta := &types.TokenCountMeta{TokenType: types.TokenTypeTokenizer}
	if info.Request != nil && (needSensitiveCheck || constant.CountToken) {
		meta = info.Request.GetTokenCountMeta()
	} else {
		// Avoid building CombineText when only the pricing quantities are needed.
		switch request := info.Request.(type) {
		case *dto.GeneralOpenAIRequest:
			meta.MaxTokens = int(max(lo.FromPtr(request.MaxTokens), lo.FromPtr(request.MaxCompletionTokens)))
		case *dto.OpenAIResponsesRequest:
			meta.MaxTokens = int(lo.FromPtr(request.MaxOutputTokens))
		case *dto.ClaudeRequest:
			meta.MaxTokens = int(lo.FromPtr(request.MaxTokens))
		case *dto.ImageRequest:
			meta = request.GetTokenCountMeta()
		}
	}

	if needSensitiveCheck && meta != nil {
		contains, words := service.CheckSensitiveText(meta.CombineText)
		if contains {
			service.RequestPolicy(c).AddEvent(service.PolicyEvent{ErrorCode: string(types.ErrorCodeSensitiveWordsDetected), ErrorSource: "local", Decision: service.PolicyDecision{Action: "stop", Reason: "local_rejection", Source: "global"}, Health: "unchanged"})
			triggerCount := 0
			userId := c.GetInt("id")
			if userId > 0 {
				count, countErr := model.IncrementSensitiveWordTriggerCount(userId)
				if countErr == nil {
					triggerCount = count
				} else {
					logger.LogError(c, "failed to increment sensitive word trigger count: "+countErr.Error())
				}
			}
			requestContent, matches := service.BuildSensitiveWordExcerpt(meta.CombineText, words, service.SensitiveWordExcerptLimit)
			matchedWordsJSON, _ := common.Marshal(words)
			matchLocations, _ := common.Marshal(matches)
			if err := model.RecordSensitiveWordViolation(&model.SensitiveWordViolation{
				UserId:         userId,
				Username:       c.GetString("username"),
				Ip:             c.ClientIP(),
				UserAgent:      c.Request.UserAgent(),
				RequestPath:    c.Request.URL.Path,
				RequestContent: requestContent,
				MatchedWords:   string(matchedWordsJSON),
				MatchLocations: string(matchLocations),
				TriggerCount:   triggerCount,
				Highlighted:    triggerCount >= model.SensitiveWordHighlightThreshold,
			}); err != nil {
				logger.LogError(c, "failed to record sensitive word violation: "+err.Error())
			}
			logger.LogWarn(c, fmt.Sprintf("user sensitive words detected: %s (count=%d)", strings.Join(words, ", "), triggerCount))
			message := "检测到敏感词，请求已停止。请切换对话。"
			// 命中词直接回显给用户，便于其自行修改提示词；仅当匹配器未给出具体词时
			// 才退回不带词的通告。
			if matchedWords := strings.Join(words, "、"); matchedWords != "" {
				message = fmt.Sprintf("检测到敏感词[%s]，请求已停止。请切换对话。", matchedWords)
			}
			// 累计触发次数达到配置阈值后自动封禁，封禁原因为 prohibited_words。
			// 封禁失败时保留原始拦截响应，避免风控写库故障放行请求。
			if userId > 0 && setting.ShouldAutoBanForSensitiveWords(triggerCount) {
				if banErr := service.BanUserForSensitiveWords(userId); banErr != nil {
					logger.LogError(c, "failed to auto ban user for sensitive words: "+banErr.Error())
				} else {
					logger.LogWarn(c, fmt.Sprintf("user auto banned for sensitive words (count=%d)", triggerCount))
					message = common.TranslateMessage(c, i18n.MsgSensitiveWordAutoBanned)
				}
			}
			return types.NewErrorWithStatusCode(errors.New(message), types.ErrorCodeSensitiveWordsDetected, http.StatusForbidden, types.ErrOptionWithSkipRetry())
		}
	}

	tokens, err := service.EstimateRequestToken(c, meta, info)
	if err != nil {
		return types.NewError(err, types.ErrorCodeCountTokenFailed)
	}
	info.SetEstimatePromptTokens(tokens)

	priceData, err := helper.ModelPriceHelper(c, info, tokens, meta)
	if err != nil {
		return types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithStatusCode(http.StatusBadRequest))
	}
	if priceData.FreeModel {
		logger.LogInfo(c, fmt.Sprintf("模型 %s 免费，跳过预扣费", info.OriginModelName))
		return nil
	}
	return service.PreConsumeBilling(c, priceData.QuotaToPreConsume, info)
}

// RefundFailedRequestBilling applies the common final-failure policy after all
// eligible attempts have ended. A settled BillingSession never refunds again.
func RefundFailedRequestBilling(c *gin.Context, info *relaycommon.RelayInfo, apiErr *types.NewAPIError) *types.NewAPIError {
	if apiErr == nil {
		return nil
	}
	apiErr = service.NormalizeViolationFeeError(apiErr)
	if info.Billing != nil {
		info.Billing.Refund(c)
	}
	service.ChargeViolationFeeIfNeeded(c, info, apiErr)
	return apiErr
}
