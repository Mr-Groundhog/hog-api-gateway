package middleware

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
)

// TicketWriteEnabled 在管理员关闭工单模块时拦截新建 / 追问。
// 只拦产生新内容的写接口：读接口与关闭保持开放，这样关闭功能后双方仍能查看
// 并收尾已有会话，不会把在途工单变成谁都看不到的孤儿数据。管理端接口不加
// 该中间件，管理员需要在关闭功能后把队列里的存量工单处理完。
func TicketWriteEnabled() func(c *gin.Context) {
	return func(c *gin.Context) {
		if !setting.IsSidebarModuleEnabled("personal", "ticket") {
			common.ApiErrorI18n(c, i18n.MsgTicketDisabled)
			c.Abort()
			return
		}
		c.Next()
	}
}
