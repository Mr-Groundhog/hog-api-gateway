package service

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
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
// 检测失败时错误文本已脱敏，可直接落库或返回给管理端。ctx 取消（管理请求断开
// 或系统任务租约丢失）时立即结束检测。
func CheckProxyConnection(ctx context.Context, proxyURL string) ProxyCheckResult {
	if ctx == nil {
		ctx = context.Background()
	}
	timeout := proxyCheckTimeout()
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	client, err := GetHttpClientWithProxySettings(proxyURL, dto.ChannelSettings{})
	if err != nil {
		return proxyCheckFailure(err)
	}
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, ProxyCheckURL(), nil)
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
		return proxyCheckFailure(errors.New("proxy check endpoint returned an unexpected status"))
	}
	return ProxyCheckResult{LatencyMs: latencyMs, ExitIp: parseProxyCheckExitIp(body)}
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
func RunProxyChecks(ctx context.Context, targets []ProxyCheckTarget) []ProxyCheckOutcome {
	outcomes := make([]ProxyCheckOutcome, len(targets))
	if len(targets) == 0 {
		return outcomes
	}
	if ctx == nil {
		ctx = context.Background()
	}
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
			check := CheckProxyConnection(ctx, target.Url)
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
