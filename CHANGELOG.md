# 更新日志

本文件记录本项目的重要变更。新增功能、优化功能与修复分开列出。

> 说明：本项目使用 commitizen（`update_changelog_on_bump: true`），正式版本发布时的 CHANGELOG 由版本 bump 自动生成。本文件用于在日常开发中提前记录改动，便于回溯。

## 未发布（Unreleased）

### ✨ 新增功能
- **兑换码批量导出 TXT**：兑换码管理页（`/redemption-codes`）多选后，底部批量操作栏新增"导出"按钮。点击后将选中兑换码的 `key` 字段逐行导出为 `.txt` 文件（文件名含选中数量），便于离线分发或备份。涉及文件：`web/src/features/redemption-codes/components/data-table-bulk-actions.tsx`，并为 en/zh/zh-TW/ja/fr/vi/ru 七种语言新增 `Export selected codes` 文案。
- **每用户每日限兑换一次额度码（可开关）**：系统设置 → 通用设置新增开关 `每用户每天仅限兑换一次额度码`。开启后，同一已登录用户每天只能成功兑换 1 张额度码（不论批次），再次兑换返回 i18n 错误 `redeem.daily_limit_reached`；关闭后恢复可多次兑换。实现上新增独立日志表 `user_redemption_logs`（`model/user_redemption_log.go`，由 `AutoMigrate` 自动建表），通过 `TodayRedemptionCount` 计数、`RecordRedemption` 记录，在充值流程（`controller/user.go` 的 `TopUp`）的锁定之后、兑换之前做校验。开关存储于 `GeneralSetting.RedemptionPerUserDailyLimit`（默认关闭，保存即生效无需重启）。涉及文件：`setting/operation_setting/general_setting.go`、`model/user_redemption_log.go`、`model/main.go`、`model/redemption.go`（`Redeem` 返回值扩展为 `(quota, redemptionId, err)`）、`controller/user.go`、`i18n/keys.go` 及 en/zh/zh-CW 翻译、前端通用设置开关 `web/src/features/system-settings/`（types、pricing-section、section-registry、billing/index、use-update-option）与七语言 `Limit redemption to once per user per day` 文案。

### 🔧 优化功能
- **敏感词检测整词匹配（英文）**：`SensitiveWordContains` 现在对纯 ASCII 字母/数字/下划线组成的敏感词（如 `hi`、`hello`、`ping`、`test`）采用整词匹配，而非子串匹配。仅当该词作为独立单词出现（前后不为字母/数字/下划线）时才命中，避免误伤 `this`、`which`、`machine`、`pinterest` 等普通英文单词。中文等非纯 ASCII 敏感词仍按子串匹配，行为不变。涉及文件：`service/sensitive.go`，新增 `searchSensitive`、`isPureAsciiWord`、`isWordBoundaryHit`、`isAsciiWordChar` 辅助函数，并补充 `service/sensitive_test.go` 测试。
- **通道测试默认招呼语调整**：`controller/channel-test.go` 中 Chat（OpenAI）、Responses、Responses Compaction、Claude、Gemini 五种格式的默认测试内容由 `hi` 改为 `In the most concise way, tell me what month it is now.`。目的是在后台配置了 `hi`/`hello` 等短英文敏感词（用于拦截用户测活）时，后台通道测试不再被自身发送的 `hi` 误拦，同时保留对真实测活请求（`hi`/`hello` 作为独立单词）的拦截能力。

### 🐛 修复
- _（本次无独立 bug 修复；上述为行为优化与误伤消除）_

### 建议的提交信息（供 commitizen 录入）
- `feat(redemption-codes): 多选兑换码支持导出为 TXT 文件`
- `feat(redemption): 新增每用户每日限兑换一次额度码开关`
- `fix(sensitive): 英文敏感词改为整词匹配以避免误伤正常英文`
- `fix(channel-test): 通道测试招呼语改为不触发 hi/hello 敏感词的探测句`
