# 渠道动态代理池 — 实施方案

## 0. 已确认决策
- 全局统一代理池（一个管理页、一个池，渠道勾选后随机用池内代理）
- 动态代理无可用代理时：**报错阻断**，不静默直连（避免真实 IP 泄漏）
- 管理接口/页面：代理地址**脱敏**显示（user:pass → ***）

## 1. 总体结构与不变量
```
管理页 /proxy-pool ─写入→ proxies 表 ─刷新→ 进程内快照(atomic.Pointer) ─随机→ 渠道出站
                                                   ▲
渠道设置 dynamic_proxy=true ──────────────────────┘
```
不变量（"不影响请求的发送"）：
- 不改 `service/http_client.go`：客户端缓存键 = 规范化代理 URL + 传输策略（协议/分片/TLS），池内每条代理天然复用各自连接池。
- 非动态渠道的请求路径与改动前逐字一致（`if !DynamicProxy` 直通分支，不查表、不拷贝）。
- 热路径零 DB / 零 Redis / 零锁竞争（atomic 快照 + `math/rand/v2.IntN`）。
- 不新增任何自动重试或自动换代理。

## 2. 数据模型

### 2.1 新表 `proxies`（`model/proxy.go`）
| 字段 | 类型 | 说明 |
|---|---|---|
| Id | int PK autoIncrement | 主键 |
| Url | varchar(512) not null | 完整代理地址 `scheme://[user:pass@]host:port`，仅允许 http/https/socks5/socks5h |
| UrlHash | varchar(64) uniqueIndex | 规范化 URL 的 SHA-256，导入去重；规避 MySQL/PG 索引长度限制 |
| Enabled | bool | 是否参与随机选择；代码显式赋值 |
| LatencyMs | int | 最近检测延迟(ms)，0=未检测/失败 |
| ExitIp | varchar(64) | 最近检测的出口 IP |
| LastCheckTime | bigint | 最近检测 Unix 秒，0=从未 |
| LastCheckOk | bool | 最近检测是否成功 |
| LastError | varchar(512) | 最近失败原因（已脱敏） |
| CreatedTime / UpdatedTime | bigint | 审计时间 |

要求：每个导出字段写中文 Go doc comment（AGENTS.md 强制）；`Enabled`/`LastCheckOk` 不用 `gorm:"default:true"`（三库布尔归一化坑）；迁移只需把 `&Proxy{}` 加入 `model/main.go` 的 `migrateDB()` AutoMigrate 列表（`migrateDBFast` 同步保持对等）——新表，老库升级直接建表，老渠道行为不变。

### 2.2 渠道设置字段（`relaykit/dto/channel_settings.go`）
```go
// DynamicProxy ... 勾选后忽略 Proxy，每次请求从全局代理池随机选择；池空时报错而非直连。
DynamicProxy bool `json:"dynamic_proxy,omitempty"`
```
优先级：`dynamic_proxy` > `proxy` > 无代理。`omitempty` 保证老渠道 setting JSON 不变。relaykit 只加字段，需 `GOWORK=off go build ./...` 验证独立性。

## 3. 快照缓存与选择（`service/proxy_pool.go`）
- `proxyPoolSnapshot{entries []{id,url}, loadedAt}` + `atomic.Pointer` 原子替换（构造新快照再换指针，不原地改）。
- `RefreshProxyPoolCache()`：只查 enabled 条目的 (id,url) 构新快照；失败**保留旧快照**并记日志（绝不因刷新失败把池清空）；`sync.Mutex` 仅包住 DB 查询以合并并发刷新，锁内无网络 IO。
- `StartProxyPoolSync(common.SyncFrequency)`：ticker 周期刷新（与 `model.SyncChannelCache` 同语义）；`main.go` 在 InitChannelCache 之后启动 + 启动时同步刷一次。不依赖 master 判定（从节点也要服务请求）。
- `PickProxyPoolURL() (string, bool)`：atomic 读 + 随机下标，O(1)。
- `ResolveChannelProxyURL(setting) (string, error)`：非动态→原样返回 `setting.Proxy`；动态→随机选，空则 `ErrProxyPoolEmpty`。
- 多实例语义：本地变更立即刷新，其他实例 ≤ `SYNC_FREQUENCY`(默认 60s)；二期可选 Redis 版本号/PubSub。
- 池规模 > 500 条时刷新打警告日志（连接池资源提醒）。

## 4. 出站接入点（关键）
**主接入点（一处覆盖绝大部分）**：`middleware/distributor.go` `SetupContextForSelectedChannel` 中，`SetContextKey(ContextKeyChannelSetting, ...)` 之前：
```go
channelSetting := channel.GetSetting()
if channelSetting.DynamicProxy {
    proxyURL, err := service.ResolveChannelProxyURL(channelSetting)
    if err != nil { return types.NewError(err, <对齐现有最接近的错误码>, /*保持可重试，让 relay 换渠道*/) }
    channelSetting.Proxy = proxyURL
}
common.SetContextKey(c, constant.ContextKeyChannelSetting, channelSetting)
```
一处即覆盖：全部 HTTP relay（`doRequest`）、WS 拨号（`DoWssRequest` 读 `info.ChannelSetting.Proxy`）、aws/coze/gemini/JS 插件在 relay 内的取数、**渠道测试**（`controller/channel-test.go:174` 也调用该函数）、relay 每次渠道重试（重新随机）。调试日志记录 channel_id + 代理 id + host（脱敏）。

**必须单独处理（否则静默直连/IP 泄漏）**：
1. `relay/responses_websocket.go` `restoreConnectionContext`：现有 `previous.Proxy != channel.GetSetting().Proxy` 会把随机值误判为"代理变更需重连"→ 动态模式下改为比较模式位（DynamicProxy），恢复时重新 Resolve，失败映射为"需重连/不可用"错误。
2. `relay/mjproxy_handler.go:38-54`：读 DB setting，proxy 为空时走 SSRF 直连 → 接入 resolver。
3. `service/task_polling.go:266,489`、`relay/relay_task.go:547`：后台任务轮询/实时状态；解析失败记日志并跳过本轮，不直连。
4. 管理侧取数（管理员触发，不影响 relay 正确性，同批改保持一致）：`controller/channel-billing.go:161,458`、`controller/channel_inference.go:105`、`controller/channel_upstream_update.go:351`、`controller/codex_usage.go:103`、`controller/video_proxy.go:229`、`service/codex_channel_models.go:28,37`、`service/codex_oauth.go:96` —— 把 `GetHttpClientWithProxySettings(setting.Proxy, setting)` 前先经过 `ResolveChannelProxyURL`。

## 5. 管理端 API / 权限 / 审计
新增 `router/proxy-router.go` + `controller/proxy.go`，沿用 `handlePermissionRoute`；新增 authz 资源 `proxy`（`service/authz/resources_proxy.go`，注册表 + 启动自动播种）：
- `read`、`operate` → 默认授予 admin；`write`（新增/编辑/导入/删除）→ 默认不授予（对齐渠道 sensitive_write：含凭据），root 始终可写

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/proxy/` | 分页列表（脱敏 URL，支持 keyword/enabled/排序） |
| GET | `/api/proxy/summary` | `{enabled,total,loaded_at}`，渠道表单提示用 |
| POST | `/api/proxy/` | 新增（url, enabled） |
| PUT | `/api/proxy/:id` | 编辑（url 留空=保留原值；enabled） |
| DELETE | `/api/proxy/:id` | 删除 |
| POST | `/api/proxy/batch` | 批量删除 `{ids}` |
| POST | `/api/proxy/status/batch` | 批量启用/禁用 `{ids, enabled}` |
| POST | `/api/proxy/import` | `{content, enabled}`（txt 内容，JSON body 而非 multipart，贴合现有 task-plugin 上传风格） |
| POST | `/api/proxy/test` | `{ids[]}` 或 `{url}`，单次 ≤ 50 条 |
| POST | `/api/proxy/delete_invalid` | `{include_never_checked=false}` |

写操作统一：分块写入 → `RefreshProxyPoolCache()` → 对被移除/改 URL 的条目 `InvalidateProxyClient(oldURL)` 关闭 idle 连接 → `recordManageAudit("proxy.*", 仅 id/host/count，绝不含凭据)`；破坏性/导入接口加 `CriticalRateLimit()`。

**脱敏**：新增 `common.MaskProxyURLCredentials`（保留 `scheme://host:port`，userinfo→`***`）——现有 `SanitizeURLForLog` 只脱敏 query 参数、`MaskSensitiveInfo` 不保留 URL 结构，都不适用；配聚焦单测。

## 6. 健康检测（延迟 / 出口 IP / 一键删除无效）
- 用 `GetHttpClientWithProxySettings(候选URL, dto.ChannelSettings{})` 发检测请求；单次超时 `PROXY_POOL_CHECK_TIMEOUT`（默认 6s）、并发上限 8（常量）、响应体 `io.LimitReader` 4KB。
- 检测地址 `PROXY_POOL_CHECK_URL`，默认 `https://api.ipify.org?format=json`（内网可改；不加 option 表，避免设置面扩大）；解析 JSON `ip` 或纯文本 IP。
- 写回该条 latency_ms / exit_ip / last_check_ok / last_error(脱敏) / last_check_time。
- 单次批量 ≤50（后端校验），前端按 20 条一批串行 + 进度提示，避免长请求。
- "无效"定义 = `last_check_time>0 && !last_check_ok`（从未检测不算，防误删新导入）；删除返回数量+id 列表、写审计、前端二次确认。

## 7. 导入（txt）
前端 `file.text()`（限 2MB）+ 允许粘贴 → POST `{content}`。后端：去 BOM、按 `\n`/`\r\n` 切分、trim、跳过空行与 `#` 注释行；逐行 `common.ParseProxyURLStrict` 校验并规范化；SHA-256 去重（含库内已有）；`CreateInBatches` 分块 200；上限 20000 行 / 2MB（超限 400）。返回 `{added, duplicated, invalid, invalid_lines:[{line, preview(脱敏截断), reason}]}`，非法行不中断整批。

## 8. 前端
- 菜单：`web/src/hooks/use-sidebar-data.ts` admin 组加 `{ title: t('Proxy Pool'), url: '/proxy-pool', icon }`（zh：代理池配置）；`use-sidebar-config.ts` 的 `URL_TO_CONFIG_MAP` 同步加入以支持菜单隐藏配置。
- 新路由 `web/src/routes/_authenticated/proxy-pool/index.tsx`（`beforeLoad` 校验 role ≥ ADMIN，风格对齐 channels）。
- 新 feature `web/src/features/proxy-pool/`：`index.tsx`(SectionPageLayout+DataTablePage)、`api.ts`(react-query)、`components/{proxy-pool-table, proxy-columns, data-table-bulk-actions, proxy-import-dialog, proxy-edit-dialog}.tsx`、`lib/proxy-pool-actions.ts`、`types.ts`(zod)。
- 列：选择框 / 代理地址(脱敏, mono) / 是否可用(开关) / 延迟(ms 分档着色，未检测=—) / 出口 IP(mono) / 最近检测(相对时间) / 失败原因(tooltip) / 操作(检测·编辑·删除)。
- 工具栏：添加、导入 TXT、检测选中、检测全部、批量启用、批量禁用、删除选中、一键删除无效（destructive + 确认弹窗）。
- 渠道表单（`features/channels`）："渠道额外设置"里 proxy 输入框上方加 Switch「动态代理（从代理池随机选择）」；勾选后禁用固定地址输入（保留原值，切回即可恢复）并显示提示与池中可用数量（读 `/api/proxy/summary`）；双向转换走 `channel-form.ts`（false 时序列化省略该键，保证老渠道 JSON 不变）；字段归属 other tab；仍受 `sensitiveLocked` 门控。
- 类型：`features/channels/types.ts` 的 `ChannelSettings` 加 `dynamic_proxy?: boolean`。
- i18n：按项目 i18n skill 流程（临时 `add-missing-keys.mjs` 写 en/zh → `bun run i18n:sync`），动态文案登记 `static-keys.ts`。

## 9. 风险与漏洞清单（对策）
1. **池空/全禁用导致静默直连 → IP 泄漏**：已决策报错阻断；所有出站路径统一走 resolver，禁止"proxy 为空就直连"的旁路。
2. **凭据泄漏**（接口/日志/审计/导入回显/异常信息）：接口脱敏；新增 `MaskProxyURLCredentials`；审计只记 id+host；导入非法行只回显行号+脱敏截断；`ParseProxyURLStrict` 原始错误带完整 URL，必须包装成不含凭据的文案。
3. **越权**：authz 新资源 `proxy`(read/operate/write) + CriticalRateLimit + 审计。
4. **SSRF / 内网探测**：沿用现有校验（仅 http/https/socks5/socks5h，禁 path/query/fragment），不额外放宽；检测 URL 由环境变量控制、响应限长。
5. **热路径性能回归**：atomic 快照 + 随机下标，无锁/无 IO/无 DB；非动态渠道直通分支。100 并发不产生 100 次 DB 查询。
6. **客户端与连接池膨胀**（每代理一个 transport，connection shards 还会乘）：删除/禁用/改 URL 时 `InvalidateProxyClient` 关 idle；提示按池规模调整 `RELAY_MAX_IDLE_CONNS`/`IdleConnTimeout`；池 >500 条警告日志。
7. **Responses WS 误判重连**：动态模式不比 URL 比模式位；恢复路径重新解析并处理失败。
8. **WS + socks5h / gorilla 能力差异**：既有实现限制（gorilla 只认 http/https/socks5），文档提示，不改变既有行为。
9. **多实例生效延迟**（≤ SYNC_FREQUENCY）：语义明确；刷新失败保留旧快照；二期可上 Redis PubSub/版本号。
10. **误删"无效"条目**：只删"上次检测明确失败"，从未检测不算，返回明细 + 审计 + 二次确认。
11. **检测压垮代理或检测站**：并发 8、单次 6s、响应限长、批量 ≤50。
12. **非幂等请求重复提交**：v1 不新增自动重试/自动换代理，只沿用现有 relay 重试语义（重试本身会重新随机选代理）。
13. **MySQL/PG 布尔默认值归一化**：不使用 `default:true`，代码显式赋值。
14. **迁移兼容**：新表 + 可选 JSON 字段；老渠道行为不变；三库全新 + 升级各跑两次验证幂等。
15. **relaykit 独立性**：`GOWORK=off go build ./...` 验证。
16. **凭据静态明文**：与现有 channel Key 存储一致，本次不引入加密（避免新增密钥管理面），显式声明。
17. **条目删除时在飞请求**：已建立连接不受影响，仅关闭 idle 连接。
18. **未检测条目滞留**：UI"未检测"徽章 + 检测全部；不自动删除。
19. **可诊断性**：选择代理时 debug 日志（channel_id、proxy id、host，脱敏）；池空时 error 日志 + 明确 relay 错误文案。

## 10. 实施阶段
1. relaykit dto 字段 + 独立构建验证
2. `model/proxy.go` + AutoMigrate + SQLite 实测
3. `service/proxy_pool.go` 快照/选择/同步 + main.go 接入
4. 出站接入：主接入点 + 上述 4 组次级点
5. authz 资源 + router + controller（CRUD/批量/导入/检测/删除无效/摘要）+ 脱敏函数与单测
6. 前端页面 + 渠道开关 + i18n
7. 验证与冒烟

## 11. 验收标准与验证命令
- 功能：`none` 渠道行为不变；固定代理渠道不变；动态渠道只从启用集合随机选；渠道 A 配置不影响 B；禁用/删除后不再被选中；池空 → 明确报错且不直连。
- 并发/性能：100 并发下发动态渠道请求，确认无逐请求 DB 查询（观察 SQL 日志/计数），无锁覆盖网络 IO。
- 安全：管理接口不返回明文密码；日志/审计无凭据。
- 命令：`go build ./...`；`cd relaykit && GOWORK=off go build ./...`；`cd tokenkit && GOWORK=off go build ./...`；`go vet ./...`；聚焦单测 `go test ./model/... ./service/... -run Proxy`。
- 三库：SQLite 本地文件（两次启动验幂等）；MySQL 5.7 与 PostgreSQL 用 Docker 起库、`SQL_DSN` 指向，全新库 + 用当前版本库升级各跑两次，记录版本与结果；**若本机无法起库，明确报告 blocker，不宣称三库兼容**。
- 前端：`bun run typecheck`、lint、相关 vitest（`__tests__/`）、`bun run i18n:sync` 无缺失项。
- 冒烟：起服务 → 池内加 1 条可用 + 1 条不可用代理 → 渠道勾动态 → 用"测试渠道"或发一次 chat 请求，日志显示选中代理且上游出口 IP 变化 → 清空/全禁用后再发，应报错且不直连。

## 12. 文件清单
新增：`model/proxy.go`、`service/proxy_pool.go`、`controller/proxy.go`、`router/proxy-router.go`、`service/authz/resources_proxy.go`、`common/proxy_url.go`（脱敏函数）、前端 `features/proxy-pool/**`、`routes/_authenticated/proxy-pool/index.tsx`、聚焦测试
修改：`relaykit/dto/channel_settings.go`、`model/main.go`、`main.go`、`middleware/distributor.go`、`relay/responses_websocket.go`、`relay/mjproxy_handler.go`、`service/task_polling.go`、`relay/relay_task.go`、`controller/{channel-billing,channel_inference,channel_upstream_update,codex_usage,video_proxy}.go`、`service/codex_*.go`、前端 `use-sidebar-data.ts`、`use-sidebar-config.ts`、`features/channels/{lib/channel-form.ts,types.ts,components/drawers/channel-mutate-drawer.tsx}`、`i18n/locales/*` + `static-keys.ts`
不新增 `docs/` 文档（AGENTS.md 禁止）。

## 13. 待实现时确认的小项
- 池空错误使用哪个现有 `types.ErrorCode`（实现时对齐枚举，保证前端/日志可诊断，不静默吞错）
- 渠道表单提示文案"池中可用 N 条"的具体措辞与 i18n key