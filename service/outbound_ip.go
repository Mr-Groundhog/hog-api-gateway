package service

import (
	"net"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

// 出站方式取值，写入管理员日志的 other.admin_info.outbound_via。
const (
	OutboundViaDirect    = "direct"
	OutboundViaProxy     = "proxy"
	OutboundViaProxyPool = "proxy_pool"
)

// OutboundInfo 描述一次请求的实际出口，供管理员日志排障。
type OutboundInfo struct {
	// Via 为 direct、proxy 或 proxy_pool。
	Via string
	// EgressIp 是出口 IP；代理出口 IP 未知时退化为代理入口 host:port。
	EgressIp string
}

// serverOutboundIpCacheTime 限制服务器出口 IP 的探测频率。
const serverOutboundIpCacheTime = 5 * time.Minute

type serverOutboundIpEntry struct {
	ip        string
	expiresAt time.Time
}

var serverOutboundIpValue atomic.Pointer[serverOutboundIpEntry]

// ServerOutboundIP 返回本机对默认路由使用的出口 IP，结果带缓存；探测失败返回空串。
// 探测方式是向公网地址做一次 UDP connect 后读取本地地址，不会真正发包；
// 没有默认路由的纯内网部署退回第一个非回环 IP。
func ServerOutboundIP() string {
	if entry := serverOutboundIpValue.Load(); entry != nil && time.Now().Before(entry.expiresAt) {
		return entry.ip
	}

	ip := ""
	if conn, err := net.Dial("udp", "8.8.8.8:53"); err == nil {
		if address, ok := conn.LocalAddr().(*net.UDPAddr); ok && address.IP != nil && !address.IP.IsUnspecified() {
			ip = address.IP.String()
		}
		_ = conn.Close()
	}
	if ip == "" {
		if addresses, err := net.InterfaceAddrs(); err == nil {
			for _, address := range addresses {
				network, ok := address.(*net.IPNet)
				if !ok || network.IP.IsLoopback() || network.IP.IsUnspecified() {
					continue
				}
				if ipv4 := network.IP.To4(); ipv4 != nil {
					ip = ipv4.String()
					break
				}
			}
		}
	}

	serverOutboundIpValue.Store(&serverOutboundIpEntry{ip: ip, expiresAt: time.Now().Add(serverOutboundIpCacheTime)})
	return ip
}

// DescribeOutbound 汇总该渠道设置的出站信息：走直连时给出服务器出口 IP，
// 走代理时优先给出代理的出口 IP，未知则退回代理入口 host:port（不含凭据）。
func DescribeOutbound(setting dto.ChannelSettings) OutboundInfo {
	if setting.Proxy == "" {
		return OutboundInfo{Via: OutboundViaDirect, EgressIp: ServerOutboundIP()}
	}
	via := OutboundViaProxy
	if setting.DynamicProxy {
		via = OutboundViaProxyPool
	}
	if exitIp, ok := ProxyPoolExitIp(setting.Proxy); ok {
		return OutboundInfo{Via: via, EgressIp: exitIp}
	}
	return OutboundInfo{Via: via, EgressIp: proxyEndpointHost(setting.Proxy)}
}

// proxyEndpointHost 返回代理地址的 host:port，用于出口 IP 未知时的兜底展示。
func proxyEndpointHost(rawProxyURL string) string {
	parsedURL, _, err := common.ParseProxyURLRuntime(rawProxyURL)
	if err != nil || parsedURL == nil {
		return ""
	}
	return parsedURL.Host
}
