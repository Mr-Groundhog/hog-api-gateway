package router

import (
	"net/http"

	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service/authz"

	"github.com/gin-gonic/gin"
)

func registerProxyRoutes(apiRouter *gin.RouterGroup) {
	proxyRoute := apiRouter.Group("/proxy")
	proxyRoute.Use(middleware.AdminAuth())

	// 破坏性操作与导入额外限流：它们会写入或删除含凭据的记录。
	handlePermissionRoute(proxyRoute, http.MethodPost, "/batch", authz.ProxyWrite, middleware.CriticalRateLimit(), controller.DeleteProxyBatch)
	handlePermissionRoute(proxyRoute, http.MethodPost, "/import", authz.ProxyWrite, middleware.CriticalRateLimit(), controller.ImportProxies)
	handlePermissionRoute(proxyRoute, http.MethodPost, "/delete_invalid", authz.ProxyWrite, middleware.CriticalRateLimit(), controller.DeleteInvalidProxies)

	for _, route := range proxyPermissionRoutes {
		handlePermissionRoute(proxyRoute, route.method, route.path, route.permission, route.handler)
	}
}

var proxyPermissionRoutes = []permissionRoute{
	{method: http.MethodGet, path: "/", permission: authz.ProxyRead, handler: controller.GetProxyList},
	{method: http.MethodGet, path: "/summary", permission: authz.ProxyRead, handler: controller.GetProxySummary},
	{method: http.MethodPost, path: "/", permission: authz.ProxyWrite, handler: controller.CreateProxy},
	{method: http.MethodPut, path: "/:id", permission: authz.ProxyWrite, handler: controller.UpdateProxy},
	{method: http.MethodDelete, path: "/:id", permission: authz.ProxyWrite, handler: controller.DeleteProxy},
	{method: http.MethodPost, path: "/status/batch", permission: authz.ProxyOperate, handler: controller.UpdateProxyStatusBatch},
	{method: http.MethodPost, path: "/test", permission: authz.ProxyOperate, handler: controller.TestProxies},
}
