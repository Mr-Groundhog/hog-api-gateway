package service

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

const (
	proxyCheckResponseMaxBytes = 4096
	// ProxyCheckMaxBatchSize 限制单次批量检测的条目数，避免管理请求长时间占用。
	ProxyCheckMaxBatchSize = 50
	// ProxyCheckConcurrency 限制单次批量检测的并发数。
	ProxyCheckConcurrency = 8
)

// ProxyCheckConfig 是当前生效的代理检测配置。Url 为空表示本地检测模式：只验证
// 代理端点可达与凭据有效，不访问外部地址，也不解析出口 IP。
type ProxyCheckConfig struct {
	Url     string
	Timeout time.Duration
}

// CurrentProxyCheckConfig 返回生效的检测配置。环境变量用于部署期固定配置，优先
// 于设置页保存的值；两者都未提供时使用内置默认值。
func CurrentProxyCheckConfig() ProxyCheckConfig {
	config := ProxyCheckConfig{
		Url:     operation_setting.GetProxyPoolSetting().CheckUrl,
		Timeout: time.Duration(operation_setting.GetProxyPoolSetting().CheckTimeoutSeconds) * time.Second,
	}
	if configured := strings.TrimSpace(os.Getenv("PROXY_POOL_CHECK_URL")); configured != "" {
		config.Url = configured
	}
	if configured := strings.TrimSpace(os.Getenv("PROXY_POOL_CHECK_TIMEOUT")); configured != "" {
		if seconds, err := strconv.Atoi(configured); err == nil && seconds > 0 {
			config.Timeout = time.Duration(seconds) * time.Second
		}
	}
	return config
}

// ProxyCheckResult 是一次代理连通性检测的结果。
type ProxyCheckResult struct {
	// LatencyMs 是检测请求的耗时（毫秒），失败时为 0。
	LatencyMs int
	// ExitIp 是检测地址观测到的出口 IP，未解析出来时为空。本地检测模式恒为空。
	ExitIp string
	// Err 为检测失败原因（已脱敏），nil 表示检测成功。
	Err error
	// ErrText 是 Err 的脱敏文本，便于直接写入数据库。
	ErrText string
}

// CheckProxyConnection 检测给定代理是否可用：配置了检测地址时经代理访问该地址
// 并解析出口 IP，未配置时只验证代理端点本身。检测失败时错误文本已脱敏，可直接
// 落库或返回给管理端。ctx 取消（管理请求断开或系统任务租约丢失）时立即结束检测。
func CheckProxyConnection(ctx context.Context, proxyURL string) ProxyCheckResult {
	return checkProxyConnection(ctx, proxyURL, CurrentProxyCheckConfig())
}

func checkProxyConnection(ctx context.Context, proxyURL string, config ProxyCheckConfig) ProxyCheckResult {
	if ctx == nil {
		ctx = context.Background()
	}
	if config.Url == "" {
		return checkProxyEndpoint(ctx, proxyURL, config.Timeout)
	}

	requestCtx, cancel := context.WithTimeout(ctx, config.Timeout)
	defer cancel()

	client, err := GetHttpClientWithProxySettings(proxyURL, dto.ChannelSettings{})
	if err != nil {
		return proxyCheckFailure(err)
	}
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, config.Url, nil)
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
	// 成功检测至少记 1ms，使 0 只表示失败（本地端点常在 1ms 内完成）。
	latencyMs := max(1, int(time.Since(startedAt).Milliseconds()))
	if err != nil {
		return proxyCheckFailure(err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return proxyCheckFailure(errors.New("proxy check endpoint returned an unexpected status"))
	}
	return ProxyCheckResult{LatencyMs: latencyMs, ExitIp: parseProxyCheckExitIp(body)}
}

// checkProxyEndpoint 不访问任何外部地址，只做本地检测：连接代理端点，并按协议
// 校验凭据。它能判断代理是否可用、是否需要认证以及认证是否成功，但无法证明代理
// 能转发流量，也无法得到出口 IP。
func checkProxyEndpoint(ctx context.Context, proxyURL string, timeout time.Duration) ProxyCheckResult {
	parsedURL, _, err := common.ParseProxyURLRuntime(proxyURL)
	if err != nil {
		return proxyCheckFailure(err)
	}
	address := parsedURL.Host
	if parsedURL.Port() == "" {
		address = net.JoinHostPort(parsedURL.Hostname(), defaultProxyPort(parsedURL.Scheme))
	}

	startedAt := time.Now()
	dialer := &net.Dialer{Timeout: timeout}
	connection, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return proxyCheckFailure(fmt.Errorf("proxy endpoint is unreachable: %w", err))
	}
	defer connection.Close()
	_ = connection.SetDeadline(time.Now().Add(timeout))

	switch parsedURL.Scheme {
	case "http":
		err = probeHTTPProxyAuthentication(connection, parsedURL)
	case "https":
		tlsConnection := tls.Client(connection, &tls.Config{ServerName: parsedURL.Hostname()})
		if err := tlsConnection.HandshakeContext(ctx); err != nil {
			return proxyCheckFailure(fmt.Errorf("proxy TLS handshake failed: %w", err))
		}
		defer tlsConnection.Close()
		err = probeHTTPProxyAuthentication(tlsConnection, parsedURL)
	case "socks5", "socks5h":
		err = probeSocks5Authentication(connection, parsedURL)
	default:
		err = fmt.Errorf("unsupported proxy scheme")
	}
	if err != nil {
		return proxyCheckFailure(err)
	}
	return ProxyCheckResult{LatencyMs: max(1, int(time.Since(startedAt).Milliseconds()))}
}

func defaultProxyPort(scheme string) string {
	switch scheme {
	case "http":
		return "80"
	case "https":
		return "443"
	default:
		return "1080"
	}
}

// probeHTTPProxyAuthentication 发送 CONNECT 探测代理认证：目标固定为必然不可达的
// 回环地址，因此认证失败会返回 407，认证通过时代理会自行尝试连接并回 5xx，两种
// 响应都能区分，且都不依赖外部网络。
func probeHTTPProxyAuthentication(connection net.Conn, proxyURL *url.URL) error {
	const unreachableTarget = "127.0.0.1:1"
	var request strings.Builder
	request.WriteString("CONNECT " + unreachableTarget + " HTTP/1.1\r\n")
	request.WriteString("Host: " + unreachableTarget + "\r\n")
	if proxyURL.User != nil {
		password, _ := proxyURL.User.Password()
		credentials := base64.StdEncoding.EncodeToString([]byte(proxyURL.User.Username() + ":" + password))
		request.WriteString("Proxy-Authorization: Basic " + credentials + "\r\n")
	}
	request.WriteString("\r\n")
	if _, err := io.WriteString(connection, request.String()); err != nil {
		return fmt.Errorf("proxy probe failed: %w", err)
	}

	statusLine, err := bufio.NewReader(connection).ReadString('\n')
	if err != nil {
		return fmt.Errorf("proxy did not answer the probe: %w", err)
	}
	fields := strings.Fields(statusLine)
	if len(fields) < 2 {
		return errors.New("proxy answered the probe with an invalid status line")
	}
	status, err := strconv.Atoi(fields[1])
	if err != nil {
		return errors.New("proxy answered the probe with an invalid status line")
	}
	if status == http.StatusProxyAuthRequired || status == http.StatusUnauthorized {
		return errors.New("proxy authentication failed")
	}
	return nil
}

// probeSocks5Authentication 执行 SOCKS5 方法协商与用户名/密码认证（RFC 1928、
// RFC 1929），验证端点可用与凭据有效。
func probeSocks5Authentication(connection net.Conn, proxyURL *url.URL) error {
	hasCredentials := proxyURL.User != nil
	methods := []byte{0x00}
	if hasCredentials {
		methods = []byte{0x00, 0x02}
	}
	greeting := append([]byte{0x05, byte(len(methods))}, methods...)
	if _, err := connection.Write(greeting); err != nil {
		return fmt.Errorf("proxy probe failed: %w", err)
	}

	reply := make([]byte, 2)
	if _, err := io.ReadFull(connection, reply); err != nil {
		return fmt.Errorf("proxy did not answer the probe: %w", err)
	}
	if reply[0] != 0x05 {
		return errors.New("proxy answered with an unexpected SOCKS version")
	}
	switch reply[1] {
	case 0x00:
		return nil
	case 0x02:
		if !hasCredentials {
			return errors.New("proxy requires authentication")
		}
		return authenticateSocks5UserPassword(connection, proxyURL)
	case 0xFF:
		return errors.New("proxy rejected all offered authentication methods")
	default:
		return fmt.Errorf("proxy selected unsupported authentication method 0x%02x", reply[1])
	}
}

func authenticateSocks5UserPassword(connection net.Conn, proxyURL *url.URL) error {
	password, _ := proxyURL.User.Password()
	username := []byte(proxyURL.User.Username())
	passwordBytes := []byte(password)
	if len(username) > 255 || len(passwordBytes) > 255 {
		return errors.New("proxy credentials are too long")
	}
	request := []byte{0x01, byte(len(username))}
	request = append(request, username...)
	request = append(request, byte(len(passwordBytes)))
	request = append(request, passwordBytes...)
	if _, err := connection.Write(request); err != nil {
		return fmt.Errorf("proxy probe failed: %w", err)
	}

	reply := make([]byte, 2)
	if _, err := io.ReadFull(connection, reply); err != nil {
		return fmt.Errorf("proxy did not answer the probe: %w", err)
	}
	if reply[1] != 0x00 {
		return errors.New("proxy authentication failed")
	}
	return nil
}

// ProxyCheckTarget 是一次批量检测的输入条目。
type ProxyCheckTarget struct {
	Id  int
	Url string
}

// ProxyCheckOutcome 是单个条目的检测结果，Url 已脱敏，可直接返回给管理端。
type ProxyCheckOutcome struct {
	Id        int
	Url       string
	Ok        bool
	LatencyMs int
	ExitIp    string
	ErrText   string
	// Skipped 表示 ctx 在检测开始前已被取消：该条目未检测、未落库，也不计入
	// 检测统计。取消不能记为失败，否则批量删除无效代理会误删整池条目。
	Skipped bool
}

// RunProxyChecks 并发检测给定条目，每条完成后立即写回数据库，返回结果与输入同序。
// 同一次运行的检测配置只解析一次，避免运行中途配置变化导致结果不一致。
func RunProxyChecks(ctx context.Context, targets []ProxyCheckTarget) []ProxyCheckOutcome {
	outcomes := make([]ProxyCheckOutcome, len(targets))
	if len(targets) == 0 {
		return outcomes
	}
	if ctx == nil {
		ctx = context.Background()
	}
	config := CurrentProxyCheckConfig()
	cancelReason := "check canceled"
	if err := ctx.Err(); err != nil {
		cancelReason = err.Error()
	}
	semaphore := make(chan struct{}, ProxyCheckConcurrency)
	var waitGroup sync.WaitGroup
	for index, target := range targets {
		if ctx.Err() != nil {
			for remaining := index; remaining < len(targets); remaining++ {
				outcomes[remaining] = skippedProxyCheckOutcome(targets[remaining], cancelReason)
			}
			break
		}
		waitGroup.Add(1)
		go func(index int, target ProxyCheckTarget) {
			defer waitGroup.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			if err := ctx.Err(); err != nil {
				outcomes[index] = skippedProxyCheckOutcome(target, err.Error())
				return
			}
			check := checkProxyConnection(ctx, target.Url, config)
			outcomes[index] = ProxyCheckOutcome{
				Id:        target.Id,
				Url:       common.MaskProxyURLCredentials(target.Url),
				Ok:        check.Err == nil,
				LatencyMs: check.LatencyMs,
				ExitIp:    check.ExitIp,
				ErrText:   check.ErrText,
			}
			if err := model.SaveProxyCheckResult(target.Id, check.LatencyMs, check.ExitIp, check.Err == nil, check.ErrText); err != nil {
				common.SysError(common.LogText("failed to save proxy check result: proxy_id=%d, %s", target.Id, err.Error()))
			}
		}(index, target)
	}
	waitGroup.Wait()
	return outcomes
}

func skippedProxyCheckOutcome(target ProxyCheckTarget, reason string) ProxyCheckOutcome {
	return ProxyCheckOutcome{
		Id:      target.Id,
		Url:     common.MaskProxyURLCredentials(target.Url),
		ErrText: reason,
		Skipped: true,
	}
}

// ProxyPoolCheckSummary 是一次代理池定时检测的汇总，写入系统任务历史。
type ProxyPoolCheckSummary struct {
	Checked   int `json:"checked"`
	Succeeded int `json:"succeeded"`
	Failed    int `json:"failed"`
	Skipped   int `json:"skipped,omitempty"`
}

// RunProxyPoolCheckOnce 检测所有启用中的代理并刷新池快照，供系统任务调度器调用。
func RunProxyPoolCheckOnce(ctx context.Context) (ProxyPoolCheckSummary, error) {
	entries, err := model.GetEnabledProxyPoolEntries()
	if err != nil {
		return ProxyPoolCheckSummary{}, err
	}
	targets := make([]ProxyCheckTarget, 0, len(entries))
	for _, entry := range entries {
		targets = append(targets, ProxyCheckTarget{Id: entry.Id, Url: entry.Url})
	}

	summary := ProxyPoolCheckSummary{}
	for _, outcome := range RunProxyChecks(ctx, targets) {
		if outcome.Skipped {
			summary.Skipped++
			continue
		}
		summary.Checked++
		if outcome.Ok {
			summary.Succeeded++
		} else {
			summary.Failed++
		}
	}

	// 检测结果中的出口 IP 参与日志与列表展示，刷新快照让新结论立即生效。
	if err := RefreshProxyPoolCache(); err != nil {
		return summary, err
	}
	return summary, nil
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
