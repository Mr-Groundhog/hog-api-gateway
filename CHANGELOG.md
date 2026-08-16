# 更新日志

本文件记录本项目的重要变更。新增功能、优化功能与修复分开列出。

> 说明：本项目使用 commitizen（`update_changelog_on_bump: true`），正式版本发布时的 CHANGELOG 由版本 bump 自动生成。本文件用于在日常开发中提前记录改动，便于回溯。

## 未发布（Unreleased）

### ✨ 新增功能
- **兑换码批量导出 TXT**：兑换码管理页（`/redemption-codes`）多选后，底部批量操作栏新增"导出"按钮。点击后将选中兑换码的 `key` 字段逐行导出为 `.txt` 文件（文件名含选中数量），便于离线分发或备份。涉及文件：`web/src/features/redemption-codes/components/data-table-bulk-actions.tsx`，并为 en/zh/zh-TW/ja/fr/vi/ru 七种语言新增 `Export selected codes` 文案。
- **每用户每日限兑换一次额度码（可开关）**：系统设置 → 通用设置新增开关 `每用户每天仅限兑换一次额度码`。开启后，同一已登录用户每天只能成功兑换 1 张额度码（不论批次），再次兑换返回 i18n 错误 `redeem.daily_limit_reached`；关闭后恢复可多次兑换。实现上新增独立日志表 `user_redemption_logs`（`model/user_redemption_log.go`，由 `AutoMigrate` 自动建表），通过 `TodayRedemptionCount` 计数、`RecordRedemption` 记录，在充值流程（`controller/user.go` 的 `TopUp`）的锁定之后、兑换之前做校验。开关存储于 `GeneralSetting.RedemptionPerUserDailyLimit`（默认关闭，保存即生效无需重启）。涉及文件：`setting/operation_setting/general_setting.go`、`model/user_redemption_log.go`、`model/main.go`、`model/redemption.go`（`Redeem` 返回值扩展为 `(quota, redemptionId, err)`）、`controller/user.go`、`i18n/keys.go` 及 en/zh/zh-CW 翻译、前端通用设置开关 `web/src/features/system-settings/`（types、pricing-section、section-registry、billing/index、use-update-option）与七语言 `Limit redemption to once per user per day` 文案。
- **用户管理「条件封禁」**：用户管理页（`/users`）"添加用户"按钮旁新增"条件封禁"按钮，点击后弹窗可批量封禁满足条件的用户（效果与单独封禁用户一致：置为禁用、提升 `auth_version` 使旧会话与令牌失效、清理令牌缓存）。支持两种封禁依据：① 按**上次登录时间**（`users.last_login_at`，默认选中）；② 按**最近调用时间**（API 调用日志 `logs.created_at`）。每种依据均可选预设时间（3天前 / 7天前 / 15天前 / 30天前）或自由设置具体日期时间（精确到分钟）。root 用户及操作者无权管理的角色不会被封禁；调用后 toast 提示实际封禁数量。后端新增 `POST /api/user/ban_by_condition`（`controller/user.go` 的 `BanUserByCondition`）；前端新增组件 `web/src/features/users/components/ban-by-condition-dialog.tsx`、API `banUserByCondition`（`api.ts`）、类型（`types.ts`）、主按钮入口（`users-primary-buttons.tsx`）、渲染挂载（`index.tsx`），并为 en/zh/zh-TW/ja/fr/vi/ru 七语言新增 `Conditional Ban`、`Confirm ban`、`Custom time`、`Last API call time`、`Last login time`、`No users matched the condition`、`Time before`、`{{count}} user(s) banned successfully`、`Banned users will be disabled immediately and their sessions and tokens will be invalidated.` 文案。
- **用户列表新增「登录 IP」列**：用户管理页表格在"上次登录"列后新增"登录 IP"列，展示该用户**最近一次成功登录系统所使用的 IP**。后端在 `users` 表新增字段 `last_login_ip`（`varchar(64)`，由 `AutoMigrate` 自动建列，无需手动迁移），并在每次登录成功（`setupLoginAtAuthVersion`，覆盖密码 / 2FA / Passkey / OAuth / 微信 / Telegram 全部登录方式）时通过 `model.UpdateUserLastLoginIp` 写入 `c.ClientIP()`。仅保留最近一次 IP；完整的多次登录 IP 历史仍由既有的登录审计日志（`RecordLoginLog`，每次成功登录均记录 IP）保留，可在登录历史中查看。前端 `User` 类型新增 `last_login_ip`，`users-columns.tsx` 新增该列，并为 en/zh 七语言新增 `Login IP` 文案。

> 数据库变更：本次在 `users` 表**新增一个字段** `last_login_ip`（`varchar(64)`，默认空字符串），由 GORM `AutoMigrate` 在 SQLite / MySQL / PostgreSQL 上自动建列，无需手动执行迁移 SQL。条件封禁功能（上条）本身未变动数据库表或字段，复用现有 `users.status`、`users.auth_version`、`users.last_login_at` 以及调用日志表 `logs.created_at`。

### 🔧 优化功能
- **敏感词检测整词匹配（英文）**：`SensitiveWordContains` 现在对纯 ASCII 字母/数字/下划线组成的敏感词（如 `hi`、`hello`、`ping`、`test`）采用整词匹配，而非子串匹配。仅当该词作为独立单词出现（前后不为字母/数字/下划线）时才命中，避免误伤 `this`、`which`、`machine`、`pinterest` 等普通英文单词。中文等非纯 ASCII 敏感词仍按子串匹配，行为不变。涉及文件：`service/sensitive.go`，新增 `searchSensitive`、`isPureAsciiWord`、`isWordBoundaryHit`、`isAsciiWordChar` 辅助函数，并补充 `service/sensitive_test.go` 测试。
- **全局播报（Global Broadcast）展示行为优化**：页头 Logo 右侧的全局播报组件（`web/src/components/layout/components/global-broadcast.tsx`）重构为更合理的展示逻辑：
  - **受开关控制**：当系统设置 `broadcast_enabled` 为 `false` 时不再渲染播报（此前无论开关状态都会显示）。读取自 localStorage 中的最新 `status` 快照。
  - **单条不重复拼接**：仅有一条播报时静态显示，不再像之前那样复制多份无限重复同一条文本。
  - **多条改为垂直轮播**：多条播报时每条停留 10 秒，整行以"向上滑入"动画切换到下一条并循环；单条文本若超出单行宽度则在该行内横向滚动，滚动速度按文字长度自适应。
  - **对齐修正**：类型状态圆点与播报文字现已严格垂直居中对齐。
  - 涉及文件：`web/src/components/layout/components/global-broadcast.tsx`、`web/src/styles/index.css`（新增 `broadcast-slide-in` / `broadcast-text-scroll` 动画，并加入 `prefers-reduced-motion` 禁用列表）。
- **通道测试默认招呼语调整**：`controller/channel-test.go` 中 Chat（OpenAI）、Responses、Responses Compaction、Claude、Gemini 五种格式的默认测试内容由 `hi` 改为 `In the most concise way, tell me what month it is now.`。目的是在后台配置了 `hi`/`hello` 等短英文敏感词（用于拦截用户测活）时，后台通道测试不再被自身发送的 `hi` 误拦，同时保留对真实测活请求（`hi`/`hello` 作为独立单词）的拦截能力。

### 🐛 修复
- _（本次无独立 bug 修复；上述为行为优化与误伤消除）_

### 建议的提交信息（供 commitizen 录入）
- `feat(redemption-codes): 多选兑换码支持导出为 TXT 文件`
- `feat(redemption): 新增每用户每日限兑换一次额度码开关`
- `fix(sensitive): 英文敏感词改为整词匹配以避免误伤正常英文`
- `fix(channel-test): 通道测试招呼语改为不触发 hi/hello 敏感词的探测句`
