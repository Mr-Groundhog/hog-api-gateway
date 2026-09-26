package middleware

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// ClientFingerprint 计算客户端请求头指纹并登记在途计数，用于令牌分发风控。
// 挂载在 TokenAuth 之后（依赖 token_id / user_id），响应结束（含 SSE 流式）
// 后递减在途计数并按阈值记录风控事件。指纹与来源 IP 同时写入 context 供日志留痕。
func ClientFingerprint() func(c *gin.Context) {
	return func(c *gin.Context) {
		tokenId := common.GetContextKeyInt(c, constant.ContextKeyTokenId)
		if tokenId <= 0 {
			c.Next()
			return
		}
		userId := common.GetContextKeyInt(c, constant.ContextKeyUserId)
		fp := service.EnterRiskInflight(userId, tokenId, c.GetHeader, c.ClientIP())
		if fp != "" {
			c.Set(string(constant.ContextKeyClientFingerprint), fp)
		}
		defer func() {
			service.LeaveRiskInflight(userId, tokenId, fp)
		}()
		c.Next()
	}
}
