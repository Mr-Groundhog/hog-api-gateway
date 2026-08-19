# 更新日志

本文件记录本项目的重要变更。新增功能、优化功能与修复分开列出。

> 说明：本项目使用 commitizen（`update_changelog_on_bump: true`），正式版本发布时的 CHANGELOG 由版本 bump 自动生成。本文件用于在日常开发中提前记录改动，便于回溯。

## 未发布（Unreleased）

### ✨ 新增功能
- **敏感词触发记录筛选**：敏感词触发管理页面新增按用户（用户名或用户 ID）和起止日期筛选，提供搜索与重置操作；后端接口同步支持对应查询参数。
- **用户排名与管理员侧边栏菜单**：管理员侧边栏在“敏感词触发”下新增“用户排名”（`/user-ranking`）菜单和页面，基于 API 消耗日志按用户统计历史去重 IP 数量、全部 IP、一分钟内去重 IP 数和今日 API 调用次数，按 IP 数量降序排列并支持分页、定时刷新。后端新增管理员接口 `GET /api/log/user-rankings`，统计分页在日志数据库聚合查询中完成。系统设置 → 站点设置 → 侧边栏模块的管理员区域新增“敏感词触发”和“用户排名”两个独立显示开关；原“敏感词触发管理”菜单名称统一调整为“敏感词触发”。
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
- **敏感词检测整词匹配（英文）**：`SensitiveWordContains` 现在对纯 ASCII 字母/数字/下划线组成的敏感词（如 `hi`、`hello`、`ping`、`test`）采用整词匹配，而非子串匹配。仅当该词作为独立单词出现（前后不为字母/数字/下划线）时才命中，避免误伤 `this`、`which`、`machine`、`pinterest` 等普通英文单词。中文等非纯 ASCII 敏感词仍按子串匹配，行为不变。涉及文件：`service/sensitive.go`，新增 `searchSensitive`、`isPureAsciiWord`、`isWordBoundaryHit`、`isAsciiWordChar` 辅助函数，并补充 `service/sensitive_test.go` 测试。
- **全局播报（Global Broadcast）展示行为优化**：页头 Logo 右侧的全局播报组件（`web/src/components/layout/components/global-broadcast.tsx`）重构为更合理的展示逻辑：
  - **受开关控制**：当系统设置 `broadcast_enabled` 为 `false` 时不再渲染播报（此前无论开关状态都会显示）。读取自 localStorage 中的最新 `status` 快照。
  - **单条不重复拼接**：仅有一条播报时静态显示，不再像之前那样复制多份无限重复同一条文本。
  - **多条改为垂直轮播**：多条播报时每条停留 10 秒，整行以"向上滑入"动画切换到下一条并循环；单条文本若超出单行宽度则在该行内横向滚动，滚动速度按文字长度自适应。
  - **对齐修正**：类型状态圆点与播报文字现已严格垂直居中对齐。
  - 涉及文件：`web/src/components/layout/components/global-broadcast.tsx`、`web/src/styles/index.css`（新增 `broadcast-slide-in` / `broadcast-text-scroll` 动画，并加入 `prefers-reduced-motion` 禁用列表）。
- **通道测试默认招呼语调整**：`controller/channel-test.go` 中 Chat（OpenAI）、Responses、Responses Compaction、Claude、Gemini 五种格式的默认测试内容由 `hi` 改为 `In the most concise way, tell me what month it is now.`。目的是在后台配置了 `hi`/`hello` 等短英文敏感词（用于拦截用户测活）时，后台通道测试不再被自身发送的 `hi` 误拦，同时保留对真实测活请求（`hi`/`hello` 作为独立单词）的拦截能力。

### 🔄 其他改动
- **界面语言精简为两种**：前端界面语言由七种（en/zh/zh-TW/fr/ru/ja/vi）精简为仅保留**简体中文（zhCN）**与**英文（en）**，删除 `fr/ja/ru/vi/zh-TW` 五种语言文件及其未翻译报告。语言切换器下拉现在只显示"简体中文"和"English"。涉及文件：`web/src/i18n/languages.ts`、`web/src/i18n/config.ts`（`supportedLngs` 与 `resources` 同步精简）、删除 `web/src/i18n/locales/{fr,ja,ru,vi,zh-TW}.json` 及 `_reports/` 下对应文件。
- **后台侧边栏菜单改名**：系统设置侧边栏"抽奖奖项"菜单项改名为"九宫格设置"，与新增的九宫格抽奖功能命名保持一致（仅修改中文文案，英文仍为 `Lottery prizes`）。

### 🐛 修复
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
