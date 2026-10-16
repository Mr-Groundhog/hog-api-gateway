package service

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupProxyCheckTestDB(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Proxy{}))
	model.DB = db
	t.Cleanup(func() {
		model.DB = previousDB
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})
}

// newProxyEchoServer 返回一个模拟代理的服务器：无论收到什么请求都以 JSON 回显
// 出口 IP，因此既可以当作检测地址，也可以当作一条“连通”的代理。
func newProxyEchoServer(t *testing.T, exitIp string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ip":"` + exitIp + `"}`))
	}))
	t.Cleanup(server.Close)
	return server
}

func useProxyCheckEndpoint(t *testing.T, url string) {
	t.Helper()
	t.Setenv("PROXY_POOL_CHECK_URL", url)
	t.Setenv("PROXY_POOL_CHECK_TIMEOUT", "2")
}

// useLocalProxyCheck 清掉环境变量与设置项里的检测地址，让检测退回本地模式。
func useLocalProxyCheck(t *testing.T) {
	t.Helper()
	t.Setenv("PROXY_POOL_CHECK_URL", "")
	t.Setenv("PROXY_POOL_CHECK_TIMEOUT", "2")
	cfg := config.GlobalConfig.Get("proxy_pool_setting")
	require.NotNil(t, cfg)
	require.NoError(t, config.UpdateConfigFromMap(cfg, map[string]string{"check_url": ""}))
	t.Cleanup(func() {
		_ = config.UpdateConfigFromMap(cfg, map[string]string{"check_url": ""})
	})
}

// rawProxyListener 起一个只按脚本应答的 TCP 监听器，用来模拟代理端点的应答。
func rawProxyListener(t *testing.T, reply string) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = listener.Close() })

	go func() {
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer connection.Close()
				buffer := make([]byte, 512)
				_, _ = connection.Read(buffer)
				if reply != "" {
					_, _ = connection.Write([]byte(reply))
				}
			}()
		}
	}()
	return listener.Addr().String()
}

func TestLocalProxyCheckJudgesTheEndpointWithoutExternalTraffic(t *testing.T) {
	useLocalProxyCheck(t)
	require.Empty(t, CurrentProxyCheckConfig().Url)

	// 端点在但拒绝该请求：说明地址可达、凭据可用，本地检测应判定成功。
	reachable := rawProxyListener(t, "HTTP/1.1 502 Bad Gateway\r\n\r\n")
	result := CheckProxyConnection(context.Background(), "http://"+reachable)
	require.NoError(t, result.Err)
	assert.Positive(t, result.LatencyMs)
	assert.Empty(t, result.ExitIp)

	// 代理要求认证而配置里没有凭据。
	authRequired := rawProxyListener(t, "HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")
	result = CheckProxyConnection(context.Background(), "http://"+authRequired)
	require.Error(t, result.Err)
	assert.Contains(t, result.ErrText, "authentication failed")

	// 端口无人监听。
	result = CheckProxyConnection(context.Background(), "http://127.0.0.1:1")
	require.Error(t, result.Err)
	assert.Contains(t, result.ErrText, "unreachable")
}

func TestLocalProxyCheckNegotiatesSocks5Credentials(t *testing.T) {
	useLocalProxyCheck(t)

	// 无需认证的 SOCKS5：协商结果为 0x00。
	noAuth := rawProxyListener(t, "\x05\x00")
	result := CheckProxyConnection(context.Background(), "socks5://"+noAuth)
	require.NoError(t, result.Err)

	// 要求用户名/密码认证且未配置凭据。
	authRequired := rawProxyListener(t, "\x05\x02")
	result = CheckProxyConnection(context.Background(), "socks5://"+authRequired)
	require.Error(t, result.Err)
	assert.Contains(t, result.ErrText, "requires authentication")
}

func TestProxyCheckConfigPrefersEnvironmentOverSettings(t *testing.T) {
	t.Setenv("PROXY_POOL_CHECK_URL", "")
	t.Setenv("PROXY_POOL_CHECK_TIMEOUT", "")
	cfg := config.GlobalConfig.Get("proxy_pool_setting")
	require.NotNil(t, cfg)
	require.NoError(t, config.UpdateConfigFromMap(cfg, map[string]string{
		"check_url":             "https://settings.example.com/echo",
		"check_timeout_seconds": "12",
	}))
	t.Cleanup(func() {
		_ = config.UpdateConfigFromMap(cfg, map[string]string{
			"check_url":             "",
			"check_timeout_seconds": "6",
		})
	})

	// 设置页保存的值在未配置环境变量时生效。
	effective := CurrentProxyCheckConfig()
	assert.Equal(t, "https://settings.example.com/echo", effective.Url)
	assert.Equal(t, 12*time.Second, effective.Timeout)

	// 环境变量优先，便于部署期固定配置。
	t.Setenv("PROXY_POOL_CHECK_URL", "https://env.example.com/echo")
	t.Setenv("PROXY_POOL_CHECK_TIMEOUT", "3")
	effective = CurrentProxyCheckConfig()
	assert.Equal(t, "https://env.example.com/echo", effective.Url)
	assert.Equal(t, 3*time.Second, effective.Timeout)
}

func TestProxyPoolCheckUrlValidation(t *testing.T) {
	// 空值合法：表示本地检测模式。
	require.NoError(t, operation_setting.ValidateProxyPoolCheckUrl(""))
	require.NoError(t, operation_setting.ValidateProxyPoolCheckUrl("   "))
	require.NoError(t, operation_setting.ValidateProxyPoolCheckUrl("http://127.0.0.1:8080/echo"))
	require.NoError(t, operation_setting.ValidateProxyPoolCheckUrl("https://api.ipify.org?format=json"))

	assert.Error(t, operation_setting.ValidateProxyPoolCheckUrl("ftp://example.com"))
	assert.Error(t, operation_setting.ValidateProxyPoolCheckUrl("api.ipify.org"))
	assert.Error(t, operation_setting.ValidateProxyPoolCheckUrl("http://"))
}

func TestRunProxyPoolCheckOncePersistsResultsAndRefreshesPool(t *testing.T) {
	setupProxyCheckTestDB(t)
	reachable := newProxyEchoServer(t, "203.0.113.7")
	// 127.0.0.1:1 不会接受连接，用于覆盖检测失败的分支。
	useProxyCheckEndpoint(t, reachable.URL+"/echo")

	unreachable := model.Proxy{Url: "http://127.0.0.1:1", UrlHash: "hash-unreachable", Enabled: true}
	require.NoError(t, model.CreateProxy(&unreachable))

	// 停用条目不参与定时检测。
	disabled := model.Proxy{Url: "http://127.0.0.1:2", UrlHash: "hash-disabled", Enabled: false}
	require.NoError(t, model.CreateProxy(&disabled))

	enabled := model.Proxy{Url: reachable.URL, UrlHash: "hash-enabled", Enabled: true}
	require.NoError(t, model.CreateProxy(&enabled))
	t.Cleanup(func() {
		InvalidateProxyClient(unreachable.Url)
		InvalidateProxyClient(enabled.Url)
	})

	summary, err := RunProxyPoolCheckOnce(context.Background())
	require.NoError(t, err)
	assert.Equal(t, ProxyPoolCheckSummary{Checked: 2, Succeeded: 1, Failed: 1}, summary)

	saved, err := model.GetProxyById(enabled.Id)
	require.NoError(t, err)
	assert.True(t, saved.LastCheckOk)
	assert.Positive(t, saved.LastCheckTime)
	assert.Equal(t, "203.0.113.7", saved.ExitIp)
	assert.Empty(t, saved.LastError)

	failed, err := model.GetProxyById(unreachable.Id)
	require.NoError(t, err)
	assert.False(t, failed.LastCheckOk)
	assert.Positive(t, failed.LastCheckTime)
	assert.NotEmpty(t, failed.LastError)

	untouched, err := model.GetProxyById(disabled.Id)
	require.NoError(t, err)
	assert.Zero(t, untouched.LastCheckTime)
	assert.Empty(t, untouched.LastError)

	// 快照只含启用条目，检测后应立刻反映最新结论（含新解析出的出口 IP）。
	enabledCount, loadedAt := ProxyPoolStatus()
	assert.Equal(t, 2, enabledCount)
	assert.False(t, loadedAt.IsZero())
	exitIp, ok := ProxyPoolExitIp(enabled.Url)
	assert.True(t, ok)
	assert.Equal(t, "203.0.113.7", exitIp)
}

func TestRunProxyPoolCheckOnceCancellationSkipsWithoutRecordingFailures(t *testing.T) {
	setupProxyCheckTestDB(t)
	echo := newProxyEchoServer(t, "203.0.113.9")
	useProxyCheckEndpoint(t, echo.URL+"/echo")

	proxy := model.Proxy{Url: echo.URL, UrlHash: "hash-cancel", Enabled: true}
	require.NoError(t, model.CreateProxy(&proxy))

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	summary, err := RunProxyPoolCheckOnce(ctx)
	require.NoError(t, err)
	assert.Equal(t, ProxyPoolCheckSummary{Skipped: 1}, summary)

	// 取消既不能记为失败，也不能写坏最近一次有效结论，否则“删除无效代理”会误删。
	saved, err := model.GetProxyById(proxy.Id)
	require.NoError(t, err)
	assert.Zero(t, saved.LastCheckTime)
	assert.False(t, saved.LastCheckOk)
	assert.Empty(t, saved.LastError)
}

func TestRunProxyPoolCheckOnceWithEmptyPool(t *testing.T) {
	setupProxyCheckTestDB(t)
	summary, err := RunProxyPoolCheckOnce(context.Background())
	require.NoError(t, err)
	assert.Equal(t, ProxyPoolCheckSummary{}, summary)
}

func TestProxyPoolAutoCheckMinutesNormalizationAndValidation(t *testing.T) {
	assert.Equal(t, operation_setting.DefaultProxyPoolAutoCheckMinutes, operation_setting.NormalizeProxyPoolAutoCheckMinutes(0))
	assert.Equal(t, operation_setting.MinProxyPoolAutoCheckMinutes, operation_setting.NormalizeProxyPoolAutoCheckMinutes(1))
	assert.Equal(t, 45, operation_setting.NormalizeProxyPoolAutoCheckMinutes(45))
	assert.Equal(t, operation_setting.MaxProxyPoolAutoCheckMinutes, operation_setting.NormalizeProxyPoolAutoCheckMinutes(99999))

	require.NoError(t, operation_setting.ValidateProxyPoolAutoCheckMinutes("1"))
	require.NoError(t, operation_setting.ValidateProxyPoolAutoCheckMinutes("1440"))
	assert.Error(t, operation_setting.ValidateProxyPoolAutoCheckMinutes("0"))
	assert.Error(t, operation_setting.ValidateProxyPoolAutoCheckMinutes("1441"))
	assert.Error(t, operation_setting.ValidateProxyPoolAutoCheckMinutes(""))
	assert.Error(t, operation_setting.ValidateProxyPoolAutoCheckMinutes("30m"))
}

func TestCheckProxyConnectionCancellationStopsPromptly(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	t.Cleanup(slow.Close)
	useProxyCheckEndpoint(t, slow.URL)
	t.Setenv("PROXY_POOL_CHECK_TIMEOUT", "30")

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	startedAt := time.Now()
	result := CheckProxyConnection(ctx, "")
	require.Error(t, result.Err)
	assert.Less(t, time.Since(startedAt), 5*time.Second)
}
