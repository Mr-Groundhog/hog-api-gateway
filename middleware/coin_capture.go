package middleware

import (
	"mime"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
)

// CoinCaptureBrowserWrite requires a console session and protects reward writes
// even in HTTP development mode. Fetch Metadata handles same-origin requests
// through proxies; older browsers fall back to Origin/Referer verification.
func CoinCaptureBrowserWrite() gin.HandlerFunc {
	protection := http.NewCrossOriginProtection()
	for _, origin := range common.SessionCookieTrustedURLs {
		if err := protection.AddTrustedOrigin(origin); err != nil {
			common.SysError(common.LogText("coin capture trusted origin rejected: %s", err.Error()))
		}
	}
	return func(c *gin.Context) {
		if c.GetBool("use_access_token") {
			abortWithWebMessage(c, http.StatusForbidden, "COIN_CAPTURE_SESSION_REQUIRED", common.NewMessage("A browser login session is required to play"))
			return
		}
		request := c.Request
		if request.Header.Get("Sec-Fetch-Site") != "same-origin" {
			origin, ok := requestBrowserOrigin(request)
			if !ok {
				abortWithWebMessage(c, http.StatusForbidden, "COIN_CAPTURE_ORIGIN_FORBIDDEN", common.NewMessage("Game request origin is not allowed"))
				return
			}
			if request.Header.Get("Origin") == "" {
				request = request.Clone(request.Context())
				request.Header.Set("Origin", origin)
			}
		}
		if err := protection.Check(request); err != nil {
			abortWithWebMessage(c, http.StatusForbidden, "COIN_CAPTURE_ORIGIN_FORBIDDEN", common.NewMessage("Game request origin is not allowed"))
			return
		}
		mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
		if err != nil || mediaType != "application/json" || c.GetHeader("X-Coin-Capture") != "1" {
			abortWithWebMessage(c, http.StatusBadRequest, "COIN_CAPTURE_INVALID_REQUEST", common.NewMessage("Invalid game request"))
			return
		}
		// At most 2000 fixed-tick target changes for a 40-second round.
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256*1024)
		c.Next()
	}
}

func CoinCaptureStartEnabled() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !setting.IsSidebarModuleEnabled("personal", "welfareAirdrop") {
			abortWithWebMessage(c, http.StatusForbidden, "COIN_CAPTURE_DISABLED", common.NewMessage("Coin Capture Operation is currently unavailable"))
			return
		}
		c.Next()
	}
}

func CoinCaptureRateLimit() gin.HandlerFunc {
	return userRateLimitFactory(10, 60, "coin-capture-settlement")
}
func CoinCaptureStartRateLimit() gin.HandlerFunc {
	return userRateLimitFactory(5, 60, "coin-capture-start")
}
