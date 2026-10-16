package service

import (
	"errors"
	"math/rand/v2"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

// ErrProxyPoolEmpty 表示渠道启用了动态代理，但代理池当前没有可用条目。
// 调用方必须把该错误暴露出去，绝不能回退为直连，否则会泄漏本机出口 IP。
var ErrProxyPoolEmpty = errors.New("no enabled proxy in the proxy pool")

// proxyPoolTooLargeThreshold 是代理池规模的告警阈值。池内每条代理都会持有独立的
// HTTP 客户端与连接池，池过大时空闲连接占用会显著上升。
const proxyPoolTooLargeThreshold = 500

// ProxyPoolPick 是一次代理池随机选择的结果。
type ProxyPoolPick struct {
	Id     int
	Url    string
	ExitIp string
}

type proxyPoolEntry struct {
	id     int
	url    string
	exitIp string
}

type proxyPoolSnapshot struct {
	entries     []proxyPoolEntry
	exitIpByUrl map[string]string
	loadedAt    time.Time
}

var (
	proxyPoolValue       atomic.Pointer[proxyPoolSnapshot]
	proxyPoolRefreshLock sync.Mutex
)

// RefreshProxyPoolCache 从数据库重建代理池快照并原子替换当前快照。查询或建表失败
// 时保留旧快照：宁可短暂使用陈旧配置，也不能把池清空导致动态代理渠道全部失败。
func RefreshProxyPoolCache() error {
	proxyPoolRefreshLock.Lock()
	defer proxyPoolRefreshLock.Unlock()

	rows, err := model.GetEnabledProxyPoolEntries()
	if err != nil {
		return err
	}
	entries := make([]proxyPoolEntry, 0, len(rows))
	exitIpByUrl := make(map[string]string, len(rows))
	for _, row := range rows {
		entries = append(entries, proxyPoolEntry{id: row.Id, url: row.Url, exitIp: row.ExitIp})
		if row.ExitIp != "" {
			exitIpByUrl[row.Url] = row.ExitIp
		}
	}
	proxyPoolValue.Store(&proxyPoolSnapshot{
		entries:     entries,
		exitIpByUrl: exitIpByUrl,
		loadedAt:    time.Now(),
	})
	if len(entries) > proxyPoolTooLargeThreshold {
		common.SysLog(common.LogText(
			"proxy pool holds %d enabled proxies; every proxy keeps its own connection pool, consider shrinking the pool or tuning RELAY_MAX_IDLE_CONNS / RELAY_IDLE_CONN_TIMEOUT",
			len(entries),
		))
	}
	return nil
}

// StartProxyPoolSync 周期性刷新代理池快照，语义与 model.SyncChannelCache 一致：
// 本实例的配置变更立即生效，其他实例最迟在 frequency 秒后生效。
func StartProxyPoolSync(frequency int) {
	for {
		time.Sleep(time.Duration(frequency) * time.Second)
		if err := RefreshProxyPoolCache(); err != nil {
			common.SysError(common.LogText("failed to sync proxy pool from database: %s", err.Error()))
		}
	}
}

// PickProxyPoolEntry 从当前快照中等概率随机选择一条可用代理。
func PickProxyPoolEntry() (ProxyPoolPick, bool) {
	snapshot := proxyPoolValue.Load()
	if snapshot == nil || len(snapshot.entries) == 0 {
		return ProxyPoolPick{}, false
	}
	entry := snapshot.entries[rand.IntN(len(snapshot.entries))]
	return ProxyPoolPick{Id: entry.id, Url: entry.url, ExitIp: entry.exitIp}, true
}

// ResolveChannelProxyURL 返回该渠道本次请求实际使用的代理地址。
// 未启用动态代理时原样返回渠道配置的固定代理（可能为空，表示直连）。
func ResolveChannelProxyURL(setting dto.ChannelSettings) (string, error) {
	if !setting.DynamicProxy {
		return setting.Proxy, nil
	}
	pick, ok := PickProxyPoolEntry()
	if !ok {
		return "", ErrProxyPoolEmpty
	}
	return pick.Url, nil
}

// ProxyPoolExitIp 按代理地址返回最近一次检测到的出口 IP，用于管理端日志展示。
func ProxyPoolExitIp(proxyURL string) (string, bool) {
	snapshot := proxyPoolValue.Load()
	if snapshot == nil {
		return "", false
	}
	exitIp, ok := snapshot.exitIpByUrl[proxyURL]
	return exitIp, ok
}

// ProxyPoolStatus 返回当前快照的可用条目数与加载时间，供管理接口展示。
func ProxyPoolStatus() (enabled int, loadedAt time.Time) {
	snapshot := proxyPoolValue.Load()
	if snapshot == nil {
		return 0, time.Time{}
	}
	return len(snapshot.entries), snapshot.loadedAt
}
