package controller

import (
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// 代理池导入上限：单次导入的文本大小与行数，避免一个管理请求耗尽内存。
const (
	proxyImportMaxBytes = 2 << 20
	proxyImportMaxLines = 20000
)

type proxyCreateRequest struct {
	Url     string `json:"url"`
	Enabled *bool  `json:"enabled"`
}

type proxyUpdateRequest struct {
	// Url 为空表示保持原地址不变；地址含凭据，界面不会回传原值。
	Url     string `json:"url"`
	Enabled *bool  `json:"enabled"`
}

type proxyBatchRequest struct {
	Ids []int `json:"ids"`
}

type proxyStatusBatchRequest struct {
	Ids     []int `json:"ids"`
	Enabled bool  `json:"enabled"`
}

type proxyImportRequest struct {
	Content string `json:"content"`
	Enabled *bool  `json:"enabled"`
}

type proxyTestRequest struct {
	Ids []int  `json:"ids"`
	Url string `json:"url"`
}

type proxyDeleteInvalidRequest struct {
	// IncludeNeverChecked 为真时连从未检测过的条目一起删除，默认只删最近一次检测失败的。
	IncludeNeverChecked bool `json:"include_never_checked"`
}

// proxyView 是管理端展示用的代理条目：地址脱敏，绝不下发凭据。
type proxyView struct {
	Id            int    `json:"id"`
	Url           string `json:"url"`
	Enabled       bool   `json:"enabled"`
	LatencyMs     int    `json:"latency_ms"`
	ExitIp        string `json:"exit_ip"`
	LastCheckTime int64  `json:"last_check_time"`
	LastCheckOk   bool   `json:"last_check_ok"`
	LastError     string `json:"last_error"`
	CreatedTime   int64  `json:"created_time"`
	UpdatedTime   int64  `json:"updated_time"`
}

func newProxyView(proxy model.Proxy) proxyView {
	return proxyView{
		Id:            proxy.Id,
		Url:           common.MaskProxyURLCredentials(proxy.Url),
		Enabled:       proxy.Enabled,
		LatencyMs:     proxy.LatencyMs,
		ExitIp:        proxy.ExitIp,
		LastCheckTime: proxy.LastCheckTime,
		LastCheckOk:   proxy.LastCheckOk,
		LastError:     proxy.LastError,
		CreatedTime:   proxy.CreatedTime,
		UpdatedTime:   proxy.UpdatedTime,
	}
}

// proxyAuditTarget 只保留审计需要的非敏感信息：条目 ID 与代理入口，绝不写凭据。
func proxyAuditTarget(proxyURL string) string {
	parsedURL, _, err := common.ParseProxyURLRuntime(proxyURL)
	if err != nil || parsedURL == nil {
		return ""
	}
	return parsedURL.Host
}

// refreshProxyPoolAfterWrite 在写入成功后刷新进程内快照，并对受影响的代理关闭其
// 缓存客户端，让删除/停用/改址尽快停止复用旧连接。
func refreshProxyPoolAfterWrite(staleProxyURLs ...string) {
	for _, proxyURL := range staleProxyURLs {
		if strings.TrimSpace(proxyURL) != "" {
			service.InvalidateProxyClient(proxyURL)
		}
	}
	if err := service.RefreshProxyPoolCache(); err != nil {
		common.SysError(common.LogText("failed to refresh proxy pool after update: %s", err.Error()))
	}
}

func GetProxyList(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	filter := model.ProxyListFilter{Keyword: c.Query("keyword")}
	switch c.Query("enabled") {
	case "true":
		enabled := true
		filter.Enabled = &enabled
	case "false":
		enabled := false
		filter.Enabled = &enabled
	}

	proxies, total, err := model.GetProxyList(pageInfo, filter)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	views := make([]proxyView, 0, len(proxies))
	for _, proxy := range proxies {
		views = append(views, newProxyView(proxy))
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(views)
	common.ApiSuccess(c, pageInfo)
}

func GetProxySummary(c *gin.Context) {
	total, enabled, err := model.CountProxies()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	poolEnabled, loadedAt := service.ProxyPoolStatus()
	proxyPoolSetting := operation_setting.GetProxyPoolSetting()
	checkConfig := service.CurrentProxyCheckConfig()
	common.ApiSuccess(c, gin.H{
		"total":              total,
		"enabled":            enabled,
		"pool_enabled":       poolEnabled,
		"loaded_at":          loadedAt.Unix(),
		"check_url":          checkConfig.Url,
		"max_batch":          service.ProxyCheckMaxBatchSize,
		"auto_check_enabled": proxyPoolSetting.AutoCheckEnabled,
		"auto_check_minutes": proxyPoolSetting.AutoCheckMinutes,
	})
}

func CreateProxy(c *gin.Context) {
	request := proxyCreateRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	proxyURL, err := common.CanonicalProxyURL(request.Url)
	if err != nil {
		common.ApiErrorT(c, "Invalid proxy URL: it must use http, https, socks5, or socks5h and include a host")
		return
	}
	enabled := true
	if request.Enabled != nil {
		enabled = *request.Enabled
	}
	proxy := model.Proxy{
		Url:     proxyURL,
		UrlHash: common.ProxyURLHash(proxyURL),
		Enabled: enabled,
	}
	if err := model.CreateProxy(&proxy); err != nil {
		if isDuplicateProxyError(err) {
			common.ApiErrorT(c, "This proxy address already exists")
			return
		}
		common.ApiError(c, err)
		return
	}
	refreshProxyPoolAfterWrite()
	recordManageAudit(c, "proxy.create", map[string]any{
		"proxy_id": proxy.Id,
		"target":   proxyAuditTarget(proxyURL),
		"enabled":  enabled,
	})
	common.ApiSuccess(c, newProxyView(proxy))
}

func UpdateProxy(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	request := proxyUpdateRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	existing, err := model.GetProxyById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	fields := map[string]any{}
	staleProxyURL := ""
	if strings.TrimSpace(request.Url) != "" {
		proxyURL, err := common.CanonicalProxyURL(request.Url)
		if err != nil {
			common.ApiErrorT(c, "Invalid proxy URL: it must use http, https, socks5, or socks5h and include a host")
			return
		}
		if proxyURL != existing.Url {
			fields["url"] = proxyURL
			fields["url_hash"] = common.ProxyURLHash(proxyURL)
			// 地址变了，旧的检测结论不再适用。
			fields["latency_ms"] = 0
			fields["exit_ip"] = ""
			fields["last_check_ok"] = false
			fields["last_error"] = ""
			fields["last_check_time"] = 0
			staleProxyURL = existing.Url
		}
	}
	if request.Enabled != nil && *request.Enabled != existing.Enabled {
		fields["enabled"] = *request.Enabled
		if staleProxyURL == "" && !*request.Enabled {
			staleProxyURL = existing.Url
		}
	}
	if len(fields) == 0 {
		common.ApiSuccess(c, newProxyView(*existing))
		return
	}
	if err := model.UpdateProxyFields(id, fields); err != nil {
		if isDuplicateProxyError(err) {
			common.ApiErrorT(c, "This proxy address already exists")
			return
		}
		common.ApiError(c, err)
		return
	}
	refreshProxyPoolAfterWrite(staleProxyURL)
	updated, err := model.GetProxyById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "proxy.update", map[string]any{
		"proxy_id": id,
		"target":   proxyAuditTarget(updated.Url),
		"enabled":  updated.Enabled,
		"fields":   sortedKeys(fields),
	})
	common.ApiSuccess(c, newProxyView(*updated))
}

func DeleteProxy(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	existing, err := model.GetProxyById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.DeleteProxy(id); err != nil {
		common.ApiError(c, err)
		return
	}
	refreshProxyPoolAfterWrite(existing.Url)
	recordManageAudit(c, "proxy.delete", map[string]any{
		"proxy_id": id,
		"target":   proxyAuditTarget(existing.Url),
	})
	common.ApiSuccess(c, nil)
}

func DeleteProxyBatch(c *gin.Context) {
	request := proxyBatchRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	if len(request.Ids) == 0 {
		common.ApiErrorT(c, "No proxy selected")
		return
	}
	proxies, err := model.GetProxiesByIds(request.Ids)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	deleted, err := model.DeleteProxies(request.Ids)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	urls := make([]string, 0, len(proxies))
	for _, proxy := range proxies {
		urls = append(urls, proxy.Url)
	}
	refreshProxyPoolAfterWrite(urls...)
	recordManageAudit(c, "proxy.delete_batch", map[string]any{
		"count": deleted,
		"ids":   request.Ids,
	})
	common.ApiSuccess(c, gin.H{"deleted": deleted})
}

func UpdateProxyStatusBatch(c *gin.Context) {
	request := proxyStatusBatchRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	if len(request.Ids) == 0 {
		common.ApiErrorT(c, "No proxy selected")
		return
	}
	updated, err := model.SetProxiesEnabled(request.Ids, request.Enabled)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	refreshProxyPoolAfterWrite()
	recordManageAudit(c, "proxy.status_batch", map[string]any{
		"count":   updated,
		"ids":     request.Ids,
		"enabled": request.Enabled,
	})
	common.ApiSuccess(c, gin.H{"updated": updated})
}

func ImportProxies(c *gin.Context) {
	request := proxyImportRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	if len(request.Content) > proxyImportMaxBytes {
		common.ApiErrorT(c, "The imported file is too large")
		return
	}
	enabled := true
	if request.Enabled != nil {
		enabled = *request.Enabled
	}

	type invalidLine struct {
		Line    int    `json:"line"`
		Preview string `json:"preview"`
		Reason  string `json:"reason"`
	}
	result := struct {
		Added        int           `json:"added"`
		Duplicated   int           `json:"duplicated"`
		Invalid      int           `json:"invalid"`
		InvalidLines []invalidLine `json:"invalid_lines"`
	}{InvalidLines: []invalidLine{}}

	seenHashes := make(map[string]struct{})
	candidates := make([]model.Proxy, 0)
	candidateHashes := make([]string, 0)
	lines := strings.Split(strings.TrimPrefix(request.Content, "\uFEFF"), "\n")
	for index, rawLine := range lines {
		lineNumber := index + 1
		line := strings.TrimSpace(strings.TrimSuffix(rawLine, "\r"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if lineNumber > proxyImportMaxLines {
			common.ApiErrorT(c, "The imported file has too many lines")
			return
		}
		proxyURL, err := common.CanonicalProxyURL(line)
		if err != nil {
			result.Invalid++
			if len(result.InvalidLines) < 50 {
				result.InvalidLines = append(result.InvalidLines, invalidLine{
					Line:    lineNumber,
					Preview: common.MaskProxyURLCredentials(line),
					Reason:  err.Error(),
				})
			}
			continue
		}
		hash := common.ProxyURLHash(proxyURL)
		if _, ok := seenHashes[hash]; ok {
			result.Duplicated++
			continue
		}
		seenHashes[hash] = struct{}{}
		candidates = append(candidates, model.Proxy{
			Url:     proxyURL,
			UrlHash: hash,
			Enabled: enabled,
		})
		candidateHashes = append(candidateHashes, hash)
	}

	existing, err := model.GetExistingProxyUrlHashes(candidateHashes)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	fresh := make([]model.Proxy, 0, len(candidates))
	for _, candidate := range candidates {
		if _, ok := existing[candidate.UrlHash]; ok {
			result.Duplicated++
			continue
		}
		fresh = append(fresh, candidate)
	}

	added, err := model.ImportProxies(fresh)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	result.Added = added
	// 并发导入时唯一索引可能吞掉少量条目，按未写入数量补齐重复计数。
	result.Duplicated += len(fresh) - added
	refreshProxyPoolAfterWrite()
	recordManageAudit(c, "proxy.import", map[string]any{
		"added":      result.Added,
		"duplicated": result.Duplicated,
		"invalid":    result.Invalid,
		"enabled":    enabled,
	})
	common.ApiSuccess(c, result)
}

// proxyTestResult 是单个条目的检测结果，地址同样脱敏。
type proxyTestResult struct {
	Id        int    `json:"id"`
	Url       string `json:"url"`
	Ok        bool   `json:"ok"`
	LatencyMs int    `json:"latency_ms"`
	ExitIp    string `json:"exit_ip"`
	Error     string `json:"error,omitempty"`
}

func TestProxies(c *gin.Context) {
	request := proxyTestRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}

	// 单个未保存地址的检测：用于新增/编辑弹窗里的“测试”按钮。
	if strings.TrimSpace(request.Url) != "" && len(request.Ids) == 0 {
		proxyURL, err := common.CanonicalProxyURL(request.Url)
		if err != nil {
			common.ApiErrorT(c, "Invalid proxy URL: it must use http, https, socks5, or socks5h and include a host")
			return
		}
		check := service.CheckProxyConnection(c.Request.Context(), proxyURL)
		result := proxyTestResult{
			Url:       common.MaskProxyURLCredentials(proxyURL),
			Ok:        check.Err == nil,
			LatencyMs: check.LatencyMs,
			ExitIp:    check.ExitIp,
			Error:     check.ErrText,
		}
		common.ApiSuccess(c, gin.H{"results": []proxyTestResult{result}})
		return
	}

	if len(request.Ids) == 0 {
		common.ApiErrorT(c, "No proxy selected")
		return
	}
	if len(request.Ids) > service.ProxyCheckMaxBatchSize {
		common.ApiErrorT(c, "Too many proxies selected for one test batch")
		return
	}
	proxies, err := model.GetProxiesByIds(request.Ids)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(proxies) == 0 {
		common.ApiErrorT(c, "No proxy selected")
		return
	}

	targets := make([]service.ProxyCheckTarget, 0, len(proxies))
	for _, proxy := range proxies {
		targets = append(targets, service.ProxyCheckTarget{Id: proxy.Id, Url: proxy.Url})
	}
	results := make([]proxyTestResult, 0, len(proxies))
	for _, outcome := range service.RunProxyChecks(c.Request.Context(), targets) {
		results = append(results, proxyTestResult{
			Id:        outcome.Id,
			Url:       outcome.Url,
			Ok:        outcome.Ok,
			LatencyMs: outcome.LatencyMs,
			ExitIp:    outcome.ExitIp,
			Error:     outcome.ErrText,
		})
	}

	// 检测结果中的出口 IP 参与日志与列表展示，刷新快照让新结论立即生效。
	refreshProxyPoolAfterWrite()
	recordManageAudit(c, "proxy.test", map[string]any{"count": len(results)})
	common.ApiSuccess(c, gin.H{"results": results})
}

func DeleteInvalidProxies(c *gin.Context) {
	request := proxyDeleteInvalidRequest{}
	// 请求体可选，缺省即只删除最近一次检测失败的条目。
	_ = c.ShouldBindJSON(&request)
	invalid, err := model.GetInvalidProxies(request.IncludeNeverChecked)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(invalid) == 0 {
		common.ApiSuccess(c, gin.H{"deleted": 0, "ids": []int{}})
		return
	}
	ids := make([]int, 0, len(invalid))
	urls := make([]string, 0, len(invalid))
	for _, proxy := range invalid {
		ids = append(ids, proxy.Id)
		urls = append(urls, proxy.Url)
	}
	deleted, err := model.DeleteProxies(ids)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	refreshProxyPoolAfterWrite(urls...)
	recordManageAudit(c, "proxy.delete_invalid", map[string]any{
		"deleted":               deleted,
		"include_never_checked": request.IncludeNeverChecked,
	})
	common.ApiSuccess(c, gin.H{"deleted": deleted, "ids": ids})
}

// isDuplicateProxyError 判断写入是否命中了地址摘要唯一索引。
func isDuplicateProxyError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unique") || strings.Contains(message, "duplicate")
}

func sortedKeys(fields map[string]any) []string {
	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}
