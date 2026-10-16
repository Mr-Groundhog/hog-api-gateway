## 方案：请求策略 → 新增「代理池」分区页，配置定时检测

**位置**：系统设置 → 请求策略 → 代理池（`/system-settings/request-policies/proxy-pool`），与「渠道健康」同级。
**存储**：option 表新分组 `proxy_pool_setting`（`auto_check_enabled` + `auto_check_minutes`），保存走通用 `PUT /api/option/`（与运维各分区一致），**不**并入 request policy 快照/白名单，避免扩大 relay 策略面。
**代理池管理页**：只读显示当前生效的自动检测间隔，不提供编辑。

现状说明：后端目前没有周期性检测（只有手动检测 + 每 60s 的池快照刷新），本次新增调度能力本身。默认值：**关闭 / 30 分钟 / 1–1440 分钟**（与渠道定时检测的粒度一致）。

### 后端
1. 新增 `setting/operation_setting/proxy_pool_setting.go`（照 `monitor_setting.go`）
   - `ProxyPoolSetting{AutoCheckEnabled, AutoCheckMinutes}`，默认 false / 30，常量 Min=1、Max=1440
   - `GetProxyPoolSetting()` 读取时归一化；`ValidateProxyPoolCheckMinutes()` 写时校验
   - `config.GlobalConfig.Register("proxy_pool_setting", ...)`：键自动进入 OptionMap，`GET/PUT /api/option/` 与热更新、多实例同步开箱可用
2. `model/option.go`：`validateOptionValue` 增加该分钟键范围校验（照 `ValidateChannelTestConcurrency`）
3. `model/system_task.go`：新增 `SystemTaskTypeProxyCheck = "proxy_check"`
4. `service/proxy_check.go`
   - `CheckProxyConnection` 增加 `ctx` 参数（超时仍取环境变量，租约丢失可及时停止；调用点仅 2 处）
   - 新增 `RunProxyChecks(ctx, targets)`：并发沿用 `ProxyCheckConcurrency`，每条完成即 `SaveProxyCheckResult`，ctx 取消停止派发
   - 新增 `RunProxyPoolCheckOnce(ctx)`：取启用条目 → 并发检测 → `RefreshProxyPoolCache()`，返回 `{checked, succeeded, failed}`
5. `controller/system_task_handlers.go`：新增 `proxyCheckHandler`（`Enabled`/`Interval` 读上述设置，`Run` 调 `RunProxyPoolCheckOnce` 并写任务历史），在 `RegisterScheduledSystemTasks()` 注册 → master 单点执行 + DB 租约去重 + 调度器每 15s 重读设置，改完即生效无需重启
6. `controller/proxy.go`：批量检测改用 `RunProxyChecks`（删掉重复的并发/落库循环，手工“检测/检测全部”语义与返回不变）；`GetProxySummary` 增加 `auto_check_enabled`、`auto_check_minutes` 两个只读字段

### 前端
7. `request-policies/section-registry.tsx`：新增分区 `id: 'proxy-pool'`、`titleKey: 'Proxy Pool'`（子菜单自动出现，`$section` 路由已由注册表驱动，无需新增路由文件）
8. 新增 `request-policies/proxy-pool-section.tsx`：自动检测开关 + 检测间隔数字输入（1–1440），用 `useUpdateOption` 仅提交变更键；附说明：只检测已启用代理、检测地址与超时仍由 `PROXY_POOL_CHECK_URL` / `PROXY_POOL_CHECK_TIMEOUT` 环境变量控制
9. `request-policies/defaults.ts`：类型与默认值补两个键
10. `features/proxy-pool/index.tsx` + `types.ts`：读 summary 显示一行只读提示（「自动检测：每 30 分钟」/「已关闭」）
11. `system-info/constants.ts`：补 `proxy_check: 'Proxy pool check'`，任务面板/历史可显示名称
12. i18n：新键经 `add-missing-keys.mjs` 脚本写入 `en.json` / `zh.json` 并跑 `bun run i18n:sync`（不手改 locale）

### 验证
- 后端：`gofmt` + `go build ./...`；`relaykit/`、`tokenkit/` 不动
- 数据库：无 schema/迁移变更（只写既有 option、system_task 表行），不走三库矩阵，总结中写明依据
- 后端测试（唯一新文件 `service/proxy_check_test.go`，sqlite 内存库 + httptest）：检测成功/失败落库、`RunProxyPoolCheckOnce` 空池与 ctx 取消、设置校验/归一化边界
- 前端：扩展 `request-policies/__tests__/settings.test.tsx` 一例（分区渲染 + 保存写 `PUT /api/option/` 正确键），并跑 `bun run typecheck`、`bun run lint`、`bun run build`

默认值（关闭 / 30 分钟 / 1–1440）如无异议按此执行。