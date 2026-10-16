package service

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

// 代理池连通性检测的默认参数。检测地址必须返回调用方出口 IP：JSON {"ip": "..."}
// 或纯文本 IP 均可；纯内网部署可通过环境变量指向自建的回显服务。
const (
	defaultProxyCheckURL       = "https://api.ipify.org?format=json"
	defaultProxyCheckTimeout   = 6 * time.Second
	proxyCheckResponseMaxBytes = 4096
	// ProxyCheckMaxBatchSize 限制单次批量检测的条目数，避免管理请求长时间占用。
	ProxyCheckMaxBatchSize = 50
	// ProxyCheckConcurrency 限制单次批量检测的并发数。
	ProxyCheckConcurrency = 8
)

// ProxyCheckResult 是一次代理连通性检测的结果。
type ProxyCheckResult struct {
	// LatencyMs 是检测请求的耗时（毫秒），失败时为 0。
	LatencyMs int
	// ExitIp 是检测地址观测到的出口 IP，未解析出来时为空。
	ExitIp string
	// Err 为检测失败原因（已脱敏），nil 表示检测成功。
	Err error
	// ErrText 是 Err 的脱敏文本，便于直接写入数据库。
	ErrText string
}

// ProxyCheckURL 返回检测地址。
func ProxyCheckURL() string {
	if configured := strings.TrimSpace(os.Getenv("PROXY_POOL_CHECK_URL")); configured != "" {
		return configured
	}
	return defaultProxyCheckURL
}

func proxyCheckTimeout() time.Duration {
	configured := strings.TrimSpace(os.Getenv("PROXY_POOL_CHECK_TIMEOUT"))
	if configured == "" {
		return defaultProxyCheckTimeout
	}
	seconds, err := strconv.Atoi(configured)
	if err != nil || seconds <= 0 {
		return defaultProxyCheckTimeout
	}
	return time.Duration(seconds) * time.Second
}

// CheckProxyConnection 通过给定代理访问检测地址，返回耗时与出口 IP。
// 检测失败时错误文本已脱敏，可直接落库或返回给管理端。
func CheckProxyConnection(proxyURL string) ProxyCheckResult {
	timeout := proxyCheckTimeout()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	client, err := GetHttpClientWithProxySettings(proxyURL, dto.ChannelSettings{})
	if err != nil {
		return proxyCheckFailure(err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, ProxyCheckURL(), nil)
	if err != nil {
		return proxyCheckFailure(err)
	}
	request.Header.Set("Accept", "application/json, text/plain;q=0.9, */*;q=0.8")

	startedAt := time.Now()
	response, err := client.Do(request)
	if err != nil {
		return proxyCheckFailure(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, proxyCheckResponseMaxBytes))
	latencyMs := int(time.Since(startedAt).Milliseconds())
	if err != nil {
		return proxyCheckFailure(err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return proxyCheckFailure(fmt.Errorf("check endpoint returned status %d", response.StatusCode))
	}
	return ProxyCheckResult{LatencyMs: latencyMs, ExitIp: parseProxyCheckExitIp(body)}
}

func proxyCheckFailure(err error) ProxyCheckResult {
	if err == nil {
		return ProxyCheckResult{}
	}
	return ProxyCheckResult{Err: err, ErrText: SanitizeProxyErrorText(err)}
}

// SanitizeProxyErrorText 把可能内嵌代理地址的错误文本脱敏并截断，避免凭据进入
// 数据库、日志或管理端响应。
func SanitizeProxyErrorText(err error) string {
	if err == nil {
		return ""
	}
	masked := common.MaskProxyURLCredentials(err.Error())
	const maxLength = 500
	if len(masked) > maxLength {
		masked = masked[:maxLength]
	}
	return masked
}

// parseProxyCheckExitIp 从检测响应里提取出口 IP：先按 JSON 的 ip 字段解析，
// 再退回把整个响应体当作纯文本 IP。
func parseProxyCheckExitIp(body []byte) string {
	text := strings.TrimSpace(string(body))
	if text == "" {
		return ""
	}
	var payload struct {
		Ip string `json:"ip"`
	}
	if err := common.Unmarshal([]byte(text), &payload); err == nil {
		if ip := strings.TrimSpace(payload.Ip); ip != "" {
			return ip
		}
	}
	if ip := net.ParseIP(text); ip != nil {
		return ip.String()
	}
	return ""
}
