# 更新日志

本文件记录本项目的重要变更。新增功能、优化功能与修复分开列出。

> 说明：本项目使用 commitizen（`update_changelog_on_bump: true`），正式版本发布时的 CHANGELOG 由版本 bump 自动生成。本文件用于在日常开发中提前记录改动，便于回溯。

## 未发布（Unreleased）

### ✨ 新增功能
- **测活防护（Probe Guard）**：新增「短时间跨模型批量测活」检测与拦截功能。按用户统计滑动窗口内请求的**去重模型数**，超过阈值即判定为批量测活，按配置执行警告、观察记录或自动封禁。
  - **检测链路**：新增 `ProbeGuard()` 中间件，挂载在 `TokenAuth + Distribute` 之后（覆盖 `/v1` 转发、`/v1/realtime` WebSocket、`/suno`、Gemini `/v1beta`、Midjourney 全部任务路由），复用 `Distribute` 已解析的模型名，不重复读取请求体。
  - **滑动窗口**：Redis 可用时用 ZSet + 单 TxPipeline 实现清理/写入/续期/读取，冷却期用 `SetNX` 抢占，正确处理含冒号的模型名；无 Redis 部署提供单机内存回退（互斥锁 + 样本裁剪，用户数超 10 万自动清扫过期窗口）。
  - **处置策略**：警告（HTTP 403 + 新错误码 `batch_model_probing`）、自动封禁（达到 `max_triggers` 后禁用账户，同步 `auth_version + 1`、撤销全部浏览器会话、失效令牌与鉴权缓存）、DryRun 观察模式（只记日志不拦截）；同一冷却期内重复越界只拦截不重复计数；风控组件（Redis/DB）故障时仅记系统日志不阻断正常转发。
  - **豁免机制**：管理员角色、指定用户分组、用户 ID 白名单（豁免名单派生缓存，热路径不做字符串解析）。
  - **数据模型**：新增 `ProbeGuardLog` 表记录触发事件（用户/令牌快照、IP、User-Agent、窗口时长、去重模型清单与数量、累计触发数、处置动作）；`users` 表新增 `probe_guard_trigger_count` 字段（累计触发数，配套原子自增/清零）。
  - **配置项**（`probe_guard` 全局配置，系统设置 → 安全设置新增「测活检测」区块）：启用开关、DryRun 观察模式、检测窗口秒数（1–3600，默认 30）、去重模型阈值（2–100，默认 6）、允许触发次数（1 为即时封禁，默认 2 先警告后封禁）、排除分组、白名单用户 ID；数值项均有范围校验，前端表单带 zod 校验、仅提交变化项。
  - **管理接口**（`/api/probe-guard/*`，AdminAuth）：`GET /logs`（触发明细分页，支持按用户/IP/动作/关键词/时间段筛选）、`GET /users`（按用户聚合：记录数、dry_run 数、触发数、最大去重模型数、最近触发的模型清单/IP/时间，兼容三种数据库）、`POST /delete`（按 ID/天数/时间点/动作类型批量清理）、`POST /ban`（手动封禁）、`POST /reset-count`（清零累计触发数）。
  - 登录/鉴权提示支持新封禁原因 `batch_model_probing` 的本地化文案（en/zh-CN/zh-TW）；`relaykit/types/error.go` 纯新增错误码常量，不影响公共 API 兼容性。

> 数据库变更：本批变更新增 `probe_guard_logs` 数据表，`users` 表新增 `probe_guard_trigger_count` 字段，均由 GORM `AutoMigrate` 自动完成，无需手动迁移。
- **风控中心（敏感词违规页 Tab 化）**：原「敏感词触发」管理页升级为「风控中心」，改为双 Tab 布局：
  - **敏感词触发 Tab**：原有功能整体迁移（用户名/起止时间/仅高亮筛选、按用户折叠展开、请求内容弹窗、重置计数、封禁用户、批量删除、分页），行为不变。
  - **测活名单 Tab**（新增）：按用户聚合展示测活触发记录——测活次数、最近测试的模型（最多显示 4 个、超出显示 +N）、最近触发 IP、最近测活时间，按触发次数自动标注高/中/低风险徽章；支持按用户名/起止时间/处理动作（已警告/已封禁/观察记录）筛选；展开可查看每条触发明细（时间、IP、动作、去重模型数、模型列表、User-Agent）并执行重置计数、封禁；支持删除选中记录与一键「清空观察记录」（按 `action=dry_run` 批量删除）。
  - 侧边栏菜单「敏感词触发」同步更名为「风控中心」（含系统设置侧边栏模块管理标题）。
- **注册码（Registration Code）**：新增一次性注册码功能，管理员可生成注册码并在系统设置中开启「注册码必填」，开启后新用户注册必须提供有效注册码，用于控制注册准入。与兑换码体系相互独立，单独建表存储。
  - **数据模型**：新增 `registration_codes` 表（由 `AutoMigrate` 自动建表）：创建管理员、8 位注册码 `key`（唯一索引，字符表去除 0/O/1/I/l 等易混淆字符）、状态（启用/禁用/已使用，复用兑换码状态常量）、备注名、创建/使用时间、绑定用户、过期时间（0 表示永不过期）、软删除。`Option` 新增 `RegistrationCodeEnabled` 配置项（支持热更新）。
  - **消费与并发安全**：消费 `ConsumeRegistrationCode` 采用事务 + 行锁 + 状态 CAS（启用→已使用），并发下同一注册码只能成功注册一次（SQLite 无行锁时由 CAS 兜底）；注册流程后续失败时通过 `RestoreRegistrationCode` 恢复注册码；预检 `CheckRegistrationCodeValid` 只读校验不消费，并加随机延时防时序侧信道枚举。
  - **三条注册通道全部接入**：邮箱密码注册在用户插入成功后才消费注册码，消费失败硬删除刚创建的用户回滚；OAuth 注册通过 `POST /api/oauth/state` 的 `registration_code` 字段随 auth flow 透传到回调，仅新用户创建分支校验（已有账号 OAuth 登录不受影响），消费失败回滚新建用户及 Generic OAuth 绑定记录；微信流程无法携带注册码，开启校验后直接禁止微信创建新用户（已有账号登录不受影响）。
  - **接口**：匿名预检 `GET /api/user/registration-code/check`（独立限流 60 次/60 秒，不与注册/登录共享配额）；管理端 `/api/registration-code` 分组：分页列表、搜索（支持「已过期」虚拟状态筛选）、详情、批量创建（1–100 个，写管理审计日志）、编辑（名称/过期时间或仅切换状态）、软删单条、清理无效注册码。`/api/status` 新增返回 `registration_code_enabled`。
  - **管理前端**：兑换码页面新增「注册码」Tab，提供分页列表（关键字/状态筛选、失效行置灰、移动端卡片视图）、创建（含「永不过期/1 个月/1 周/1 天」快捷预设与批量数量）、编辑（仅未使用且未过期可编辑）、启用/禁用、删除、批量复制/导出 TXT/批量禁用、一键清理无效注册码；注册码默认掩码显示（末 4 位），点击查看/复制完整码；绑定用户列 Tooltip 展示用户 ID/用户名/使用时间；创建抽屉内新增「码类型」切换（兑换码 ↔ 注册码），选注册码时隐藏额度与空投字段。
  - **注册表单接入**：开启校验后注册表单显示注册码输入框，输入防抖 600ms 实时预校验（转圈/绿勾/红叉，区分无效/已使用/已过期），提交前再次拦截；系统设置 → 登录认证新增「注册码必填」开关。未通过注册码校验前禁用全部 OAuth 按钮（微信、Telegram 因无法携带注册码在注册码模式下单独禁用），校验通过后注册码随 OAuth state 流程传给后端。

> 数据库变更：本批变更新增 `registration_codes` 数据表，`Option` 表新增 `RegistrationCodeEnabled` 配置项，均由 GORM `AutoMigrate` 自动完成，无需手动迁移；`users` 表无结构变更（注册码字段仅用于接收请求，不落库）。
- **敏感词命中高亮与定位**：违规详情弹窗重构——抽出 `lib/matches.ts` 解析命中词并与后端检测规则对齐（大小写不敏感、纯 ASCII 词按单词边界匹配、最长命中优先），把请求内容切分为命中/普通片段高亮展示；命中词以红色 Badge 列出，支持「定位命中词」循环跳转并平滑滚动，实时显示「第 x/y 处命中 / 共命中 n 处」；主列表命中词列改为 Badge 列表。请求内容不再通过悬浮 `title` 预览，仅在详情弹窗中揭示，避免泄漏。
- **福利空投（Welfare Airdrop）**：新增限时额度空投功能，作为兑换码体系的扩展。
  - **空投活动模型**：新增 `welfare_airdrops` / `welfare_airdrop_claims` 两张表（由 `AutoMigrate` 自动建表）。活动支持名称/说明、单份额度、总库存（0 表示不限量）、每人限领 1 次、起止时间窗口、启用/停用、排序、用户分组和兑换码批次 ID（BatchId）。
  - **领取机制**：领取在单事务内完成——校验活动窗口/限次/库存 → 原子扣减库存 → 占用一张该批次未使用的空投兑换码 → 写入领取记录（含兑换码明文快照）→ 条件给用户加额度（防 int32 溢出）→ 同步额度缓存并记录充值日志，SQLite 下亦竞态安全。
  - **用户端页面**：新增 `/welfare-airdrop` 页面（`web/src/features/welfare-airdrop/`），轮播卡片展示进行中/即将开始的活动，显示单次额度、剩余库存、截止时间与状态，一键领取并展示个人最近 10 条领取记录（兑换码可复制）；后端统一判定展示状态（upcoming/active/sold_out/ended/claimed），用户端仅展示「即将开始」和「可领取」的活动。
  - **管理端**：兑换码管理页新增「空投活动」Tab（仅管理员可见），支持创建/编辑/删除/启停活动；停用/删除活动会联动停用/删除该批次未使用的空投码，已发放记录保留以便对账。新建兑换码抽屉新增「福利空投兑换码」开关，可填写/一键生成批次 ID（UUID）并设置领取截止时间（默认 7 天后）。
  - **与兑换码联动**：`Redemption` 模型新增 `is_airdrop`、`airdrop_group`、`airdrop_batch_id`、`valid_until` 字段（含联合索引）；管理员创建空投兑换码时自动同步/创建对应活动并累加库存（含并发重复建活动防护），删除、停用/启用、清理无效空投码时同步增减活动库存，避免「幽灵库存」。
  - **接口**：用户端 `GET /api/welfare-airdrop/`、`GET /api/welfare-airdrop/my-claims`、`POST /api/welfare-airdrop/claim/:id`（及简短别名 `GET /api/airdrop/status`、`POST /api/airdrop/claim`）；管理端 `GET|POST|PUT /api/welfare-airdrop/admin`、`PUT /api/welfare-airdrop/admin/status`、`DELETE /api/welfare-airdrop/admin/:id`。
  - **侧边栏入口**：个人分组新增「福利空投」菜单（Gift 图标 +「限时」高亮角标，采用新增的 `attention` 徽章样式，对减弱动效用户禁用动画）；侧边栏模块配置新增 `welfareAirdrop` 开关（默认启用）。
- **用户注册来源追踪**：`users` 表新增 `registration_source` 字段（带索引），在密码注册、管理员建用户、root 初始化/setup、微信登录及各 OAuth（GitHub/Discord/OIDC/LinuxDO/Telegram/自定义）注册入口写入对应来源；新增迁移 `InitializeUserRegistrationSources()` 按第三方 ID 绑定情况为存量用户回填来源。前端用户表格新增「注册来源」列，账号绑定字段新增「LinuxDO ID」。
- **敏感词违规按用户聚合视图**：敏感词违规管理页重构为按用户聚合的主表（按用户展示违规次数、触发次数、是否高亮、最近违规时间），点击展开查看该用户违规明细（分页、勾选记录、查看完整请求内容），展开区内保留重置计数/封禁操作。后端新增 `GET /api/sensitive_word/users`；明细列表新增 `keyword` 模糊筛选与 `user_id` 筛选，`highlighted` 筛选改为 `highlighted = true OR trigger_count >= 阈值`；移除旧的列显隐（localStorage）机制。
- **敏感词违规记录批量删除**：新增 `POST /api/sensitive_word/delete`，支持按选中 ID、按天数或自定义截止日期批量删除违规记录，前端删除对话框带预设选项。
- **兑换码批量停用**：兑换码管理页批量操作栏新增「批量停用所选兑换码」按钮，仅对启用中的码执行停用并统计成功/失败数。
- **GitHub 仓库链接**：新增带 Tooltip 的 GitHub 图标按钮组件（`web/src/components/github-link.tsx`），加入登录后应用顶栏与公共页头部。

> 数据库变更：本次变更新增 `welfare_airdrops`、`welfare_airdrop_claims` 两张表，并在 `redemptions` 表新增 `is_airdrop`、`airdrop_group`、`airdrop_batch_id`、`valid_until` 列，在 `users` 表新增 `registration_source` 列，均由 GORM `AutoMigrate` 在 SQLite / MySQL / PostgreSQL 上自动完成，无需手动迁移；另有迁移为存量用户回填注册来源。
- **敏感词触发记录筛选与管理增强**：敏感词触发管理页面支持按用户（用户名或用户 ID）、起止日期及“仅重点”筛选，提供搜索、刷新和重置操作；新增可持久化的列显示设置、详情请求内容一键复制，以及按用户清零累计触发次数（同时清除历史重点标记）。后端接口同步支持 `highlighted` 查询参数和 `POST /api/sensitive-word-violations/reset-count`。
- **敏感词过滤分组豁免**：系统安全设置新增排除分组多选项；属于这些用户分组（包括自动分组）的请求跳过敏感词过滤，但全局过滤开关仍保持生效。分组配置以 JSON 形式校验、保存并兼容 SQLite、MySQL、PostgreSQL。
- **用户排名与管理员侧边栏菜单**：管理员侧边栏在“敏感词触发”下新增“用户排名”（`/user-ranking`）菜单和页面，基于 API 消耗日志按用户统计历史去重 IP 数量、全部 IP、一分钟内去重 IP 数和今日 API 调用次数，按 IP 数量降序排列并支持分页、定时刷新。后端新增管理员接口 `GET /api/log/user-rankings`，统计分页在日志数据库聚合查询中完成；无 IP 的 API 用户也会保留在排名中，并以空数组返回 IP 列表。系统设置 → 站点设置 → 侧边栏模块的管理员区域新增“敏感词触发”和“用户排名”两个独立显示开关；原“敏感词触发管理”菜单名称统一调整为“敏感词触发”。
- **通道测试输入展示**：渠道测试弹窗新增可展开的“测试输入”面板，按端点类型展示实际发送的提示词、嵌入文本、图像提示词及重排查询/文档，便于管理员核对测试请求内容。
- **九宫格抽奖（Lottery）**：新增可配置的"九宫格抽奖"功能，页头导航新增"神秘九宫格"入口（`/lottery`，需登录，可在系统设置中开关）。
  - **抽奖页面**：前端新增抽奖页 `web/src/routes/lottery/index.tsx` 与抽奖功能模块 `web/src/features/lottery/`，包含九宫格抽奖面板、开奖动画、今日中奖记录、每日抽奖次数展示等。
  - **开奖逻辑**：后端 `service/lottery.go` 实现按权重（`weight`）加权随机开奖，并支持每个奖项每日份数（`daily_quota`，0 表示不限）限制；每位用户每个业务日（Asia/Shanghai）限抽 1 次。
  - **后台管理**：系统设置新增"九宫格设置"区块（`web/src/features/system-settings/lottery-prizes.ts`、`lottery-prizes-section.tsx`），可新增/编辑/删除/开关奖项，配置权重与每日份数。
  - **接口**：`GET /api/lottery/config`（公开奖项）、`GET /api/lottery/today-records`（今日记录）、`GET /api/lottery/status`（剩余次数）、`POST /api/lottery/draw`（抽奖）、`GET/POST/PUT/DELETE /api/lottery/prizes`（后台奖项管理，需管理员）。
  - **导航开关**：新增 `lottery` 导航模块（默认开启、默认需登录），可在系统设置导航配置中调整；`middleware/header_nav.go` 为 `lottery` 模块设置默认需登录。
  - 涉及文件：`controller/lottery.go`、`service/lottery.go`、`service/lottery_test.go`、`model/lottery.go`、`model/main.go`、`router/api-router.go`、`middleware/header_nav.go`、`web/src/lib/nav-modules.ts`、`web/src/hooks/use-top-nav-links.ts`、`web/src/features/system-settings/site/section-registry.tsx` 及抽奖相关前端文件。
- **兑换码批量导出 TXT**：兑换码管理页（`/redemption-codes`）多选后，底部批量操作栏新增"导出"按钮。点击后将选中兑换码的 `key` 字段逐行导出为 `.txt` 文件（文件名含选中数量），便于离线分发或备份。涉及文件：`web/src/features/redemption-codes/components/data-table-bulk-actions.tsx`，并为 en/zh/zh-TW/ja/fr/vi/ru 七种语言新增 `Export selected codes` 文案。
- **每用户每日限兑换一次额度码（可开关）**：系统设置 → 通用设置新增开关 `每用户每天仅限兑换一次额度码`。开启后，同一已登录用户每天只能成功兑换 1 张额度码（不论批次），再次兑换返回 i18n 错误 `redeem.daily_limit_reached`；关闭后恢复可多次兑换。实现上新增独立日志表 `user_redemption_logs`（`model/user_redemption_log.go`，由 `AutoMigrate` 自动建表），通过 `TodayRedemptionCount` 计数、`RecordRedemption` 记录，在充值流程（`controller/user.go` 的 `TopUp`）的锁定之后、兑换之前做校验。开关存储于 `GeneralSetting.RedemptionPerUserDailyLimit`（默认关闭，保存即生效无需重启）。涉及文件：`setting/operation_setting/general_setting.go`、`model/user_redemption_log.go`、`model/main.go`、`model/redemption.go`（`Redeem` 返回值扩展为 `(quota, redemptionId, err)`）、`controller/user.go`、`i18n/keys.go` 及 en/zh/zh-CW 翻译、前端通用设置开关 `web/src/features/system-settings/`（types、pricing-section、section-registry、billing/index、use-update-option）与七语言 `Limit redemption to once per user per day` 文案。
- **用户管理「条件封禁」**：用户管理页（`/users`）"添加用户"按钮旁新增"条件封禁"按钮，点击后弹窗可批量封禁满足条件的用户（效果与单独封禁用户一致：置为禁用、提升 `auth_version` 使旧会话与令牌失效、清理令牌缓存）。支持两种封禁依据：① 按**上次登录时间**（`users.last_login_at`，默认选中）；② 按**最近调用时间**（API 调用日志 `logs.created_at`）。每种依据均可选预设时间（3天前 / 7天前 / 15天前 / 30天前）或自由设置具体日期时间（精确到分钟）。root 用户及操作者无权管理的角色不会被封禁；调用后 toast 提示实际封禁数量。后端新增 `POST /api/user/ban_by_condition`（`controller/user.go` 的 `BanUserByCondition`）；前端新增组件 `web/src/features/users/components/ban-by-condition-dialog.tsx`、API `banUserByCondition`（`api.ts`）、类型（`types.ts`）、主按钮入口（`users-primary-buttons.tsx`）、渲染挂载（`index.tsx`），并为 en/zh/zh-TW/ja/fr/vi/ru 七语言新增 `Conditional Ban`、`Confirm ban`、`Custom time`、`Last API call time`、`Last login time`、`No users matched the condition`、`Time before`、`{{count}} user(s) banned successfully`、`Banned users will be disabled immediately and their sessions and tokens will be invalidated.` 文案。
- **用户手动封禁原因**：用户管理页（`/users`）手动禁用用户时新增封禁原因选择弹窗，内置“批量测活”“批量邀请小号”“多次触发违禁词”“破限或违禁信息”四种原因，并支持最多 255 个字符的自定义原因。后端在 `users` 表新增 `ban_reason`（`varchar(255)`）字段保存预设原因代码或自定义说明；重新启用用户时自动清空该字段，条件批量封禁统一记录“超过15天未登录且无 API 调用记录”。密码、OAuth、微信及 Passkey 登录检测到用户被封禁时，会将预设原因按当前语言转换为可读提示，自定义原因显示为“用户已被封禁：原因”；历史封禁记录的原因为空时继续使用原有系统内置提示。Redis 用户认证缓存同步增加封禁原因并提升缓存结构版本，避免登录时读取旧缓存。前端新增 `ban-reason-dialog.tsx`，修复下拉框默认值直接显示英文或内部代码的问题，并补充 en/zh 前端文案及 en/zh-CN/zh-TW 后端提示。涉及文件：`model/user.go`、`model/user_cache.go`、`model/user_auth_cache.go`、`controller/user.go`、`controller/oauth.go`、`controller/wechat.go`、`controller/passkey.go`、`i18n/`、`web/src/features/users/` 与 `web/src/i18n/locales/`。
- **用户列表新增「登录 IP」列**：用户管理页表格在"上次登录"列后新增"登录 IP"列，展示该用户**最近一次成功登录系统所使用的 IP**。后端在 `users` 表新增字段 `last_login_ip`（`varchar(64)`，由 `AutoMigrate` 自动建列，无需手动迁移），并在每次登录成功（`setupLoginAtAuthVersion`，覆盖密码 / 2FA / Passkey / OAuth / 微信 / Telegram 全部登录方式）时通过 `model.UpdateUserLastLoginIp` 写入 `c.ClientIP()`。仅保留最近一次 IP；完整的多次登录 IP 历史仍由既有的登录审计日志（`RecordLoginLog`，每次成功登录均记录 IP）保留，可在登录历史中查看。前端 `User` 类型新增 `last_login_ip`，`users-columns.tsx` 新增该列，并为 en/zh 七语言新增 `Login IP` 文案。

> 数据库变更：当前未发布变更在 `users` 表新增 `last_login_ip`（`varchar(64)`，默认空字符串）和 `ban_reason`（`varchar(255)`，默认空字符串）两个字段，均由 GORM `AutoMigrate` 在 SQLite / MySQL / PostgreSQL 上自动建列，无需手动执行迁移 SQL；没有新增数据表。条件封禁功能复用现有 `users.status`、`users.auth_version`、`users.last_login_at` 以及调用日志表 `logs.created_at`，批量封禁时会将 `ban_reason` 统一写为“超过15天未登录且无 API 调用记录”对应的原因代码。

### 🔧 优化功能
- **OAuth 按钮改版**：登录/注册页第三方登录按钮由整宽纵向文字按钮改为横向排列的 44px 图标方块按钮，Tooltip 显示提供商名称，无图标提供商显示名称首字母，并补充 `aria-label` / `title` 无障碍属性。
- **登录表单布局**：替代登录方式（Passkey / 微信 / OAuth）统一固定展示在账号密码表单下方，不再根据登录方式组合切换位置。
- **播报管理**：系统设置中新建播报插入到列表顶部（而非尾部），操作列右对齐。
- **空投活动管理布局**：改为撑满 Tab 内容区、内部纵向滚动的容器，替换原固定 `max-w-5xl` 卡片式布局。
- **用户 IP 排行改版**：`GET /api/user_ip_rankings` 新增 `period` 参数，支持「今日 / 近 3 天」时间维度查询，改为按去重 IP 数排序一次性返回 Top 50（移除分页，前端保留 30 秒自动刷新）；指标变更：`recent_ip_count` 改为 `ten_minute_ip_count`（近 10 分钟去重 IP），`today_api_calls` 改为随周期变化的 `api_calls`，缺失/非法数值统一归一化为 0。
- **会话过期提示去重**：401 会话过期时「Session expired!」toast 改为会话周期内只提示一次，避免并发请求失败导致重复弹窗；刷新令牌成功后重置该标记（`web/src/lib/http-client.ts`）。
- **敏感词检测整词匹配（英文）**：`SensitiveWordContains` 现在对纯 ASCII 字母/数字/下划线组成的敏感词（如 `hi`、`hello`、`ping`、`test`）采用整词匹配，而非子串匹配。仅当该词作为独立单词出现（前后不为字母/数字/下划线）时才命中，避免误伤 `this`、`which`、`machine`、`pinterest` 等普通英文单词。中文等非纯 ASCII 敏感词仍按子串匹配，行为不变。涉及文件：`service/sensitive.go`，新增 `searchSensitive`、`isPureAsciiWord`、`isWordBoundaryHit`、`isAsciiWordChar` 辅助函数，并补充 `service/sensitive_test.go` 测试。
- **全局播报（Global Broadcast）展示行为优化**：页头 Logo 右侧的全局播报组件（`web/src/components/layout/components/global-broadcast.tsx`）重构为更合理的展示逻辑：
  - **受开关控制**：当系统设置 `broadcast_enabled` 为 `false` 时不再渲染播报（此前无论开关状态都会显示）。读取自 localStorage 中的最新 `status` 快照。
  - **单条不重复拼接**：仅有一条播报时静态显示，不再像之前那样复制多份无限重复同一条文本。
  - **多条改为垂直轮播**：多条播报时每条停留 10 秒，整行以"向上滑入"动画切换到下一条并循环；单条文本若超出单行宽度则在该行内横向滚动，滚动速度按文字长度自适应。
  - **对齐修正**：类型状态圆点与播报文字现已严格垂直居中对齐。
  - 涉及文件：`web/src/components/layout/components/global-broadcast.tsx`、`web/src/styles/index.css`（新增 `broadcast-slide-in` / `broadcast-text-scroll` 动画，并加入 `prefers-reduced-motion` 禁用列表）。
- **通道测试默认招呼语调整**：`controller/channel-test.go` 中 Chat（OpenAI）、Responses、Responses Compaction、Claude、Gemini 五种格式的默认测试内容由 `hi` 改为 `In the most concise way, tell me what month it is now.`。目的是在后台配置了 `hi`/`hello` 等短英文敏感词（用于拦截用户测活）时，后台通道测试不再被自身发送的 `hi` 误拦，同时保留对真实测活请求（`hi`/`hello` 作为独立单词）的拦截能力。
- **嵌入测试默认输入调整**：通道测试的 Embeddings 请求由 `hello world` 改为 `What day is it today?`，避免与敏感词配置产生误触发，并与测试输入面板展示内容保持一致。

### 🔄 其他改动
- **界面语言精简为两种**：前端界面语言由七种（en/zh/zh-TW/fr/ru/ja/vi）精简为仅保留**简体中文（zhCN）**与**英文（en）**，删除 `fr/ja/ru/vi/zh-TW` 五种语言文件及其未翻译报告。语言切换器下拉现在只显示"简体中文"和"English"。涉及文件：`web/src/i18n/languages.ts`、`web/src/i18n/config.ts`（`supportedLngs` 与 `resources` 同步精简）、删除 `web/src/i18n/locales/{fr,ja,ru,vi,zh-TW}.json` 及 `_reports/` 下对应文件。
- **后台侧边栏菜单改名**：系统设置侧边栏"抽奖奖项"菜单项改名为"九宫格设置"，与新增的九宫格抽奖功能命名保持一致（仅修改中文文案，英文仍为 `Lottery prizes`）。

### 🐛 修复
- **敏感词违规记录按时间清理失效**：批量删除原实现强制要求选中记录 ID 且条件为 `id IN (ids) AND created_at < cutoff`，导致「按时间段清理」实际无法生效；现支持三种独立方式——按 ID 列表、按 `before_time` 时间戳、按 `days` 天数（1–36500），并返回实际删除条数。前端删除弹窗同步简化为直接确认删除所选记录。
- **兑换码创建类型串扰**：点击「创建码」时显式将创建类型重置为「兑换码」，避免与注册码创建类型互相串扰。
- **OAuth 注册邀请人丢失**：`User.Insert`/`InsertWithTx` 现在正确持久化 `inviter_id`（此前未赋值），`FinalizeOAuthUserCreation` 补写 OAuth 用户的邀请人关系；`UpdateWithTx` 可更新列中加入 `inviter_id`、`registration_source`。
- **敏感词误报**：补充英文整词匹配用例，修复 "hi" 会误匹配 "while" 等单词内子串误报问题。
- **兑换码参数校验**：创建兑换码增加 `valid_until` 非负校验，空投码要求截止时间必须晚于当前时间。
- **九宫格抽奖额度上限保护**：抽奖发放额度现在受 `common.MaxQuota` 限制，管理员配置超出可表示范围的奖项额度会被拒绝；发放时使用带额度上限和用户存在性条件的原子更新，并在更新失败时回滚整个抽奖事务，避免记录中奖但额度未正确到账或发生整数溢出。额度接近上限时返回 HTTP 409 `LOTTERY_QUOTA_OVERFLOW`。
- **九宫格抽奖额度展示统一**：用户端中奖状态改用统一的额度格式化逻辑展示，避免直接显示内部 quota 单位。
- **九宫格奖项界面精简**：抽奖格子不再重复显示奖项图标，后台奖项管理移除图标和色调编辑项，减少与固定界面主题不一致的配置入口。

### 建议的提交信息（供 commitizen 录入）
- `feat(lottery): 新增可配置的九宫格抽奖功能`
- `refactor(i18n): 界面语言精简为仅简体中文与英文`
- `feat(redemption-codes): 多选兑换码支持导出为 TXT 文件`
- `feat(redemption): 新增每用户每日限兑换一次额度码开关`
- `fix(sensitive): 英文敏感词改为整词匹配以避免误伤正常英文`
- `fix(channel-test): 通道测试招呼语改为不触发 hi/hello 敏感词的探测句`
- `feat(welfare-airdrop): 新增福利空投功能（空投活动、领取与兑换码批次联动）`
- `feat(user): 新增用户注册来源追踪并在用户列表展示`
- `feat(sensitive-word): 违规记录支持按用户聚合视图与批量删除`
- `feat(user-ranking): 用户 IP 排行改为今日/近 3 天时间维度并返回 Top 50`
- `feat(redemption-codes): 兑换码支持批量停用`
- `fix(user): 修复 OAuth 注册时邀请人未记录的问题`
- `feat(registration-code): 新增注册码功能，密码/OAuth 注册通道全部接入校验`
- `feat(sensitive-word): 违规详情弹窗支持命中词高亮与循环定位`
- `fix(sensitive-word): 修复违规记录按时间段清理不生效的问题`
- `feat(auth): OAuth 登录按钮改为图标方块排列`
- `feat(probe-guard): 新增短时间跨模型批量测活检测与自动封禁`
- `feat(risk-control): 敏感词违规页升级为风控中心并新增测活名单 Tab`
