# 工单系统 + 福利空投兑换码名称长度 — 设计文档

- 状态：已评审，按 2026-09-04 评审结论修订（v2）
- 日期：2026-09-04
- 涉及分层：`model/` → `service/` → `controller/` → `router/`，`middleware/`、`setting/`、`i18n/`，前端 `web/src/features/`、`web/src/hooks/`
- 交付形态：需求 A 与需求 B 相互独立，A 可先行合并

## 0. 评审结论（v2 相对 v1 的收敛）

| 项 | v1 设计 | v2 结论 | 影响 |
| --- | --- | --- | --- |
| 需求 A 范围 | 「统一放宽」与「仅空投放宽」两案并列 | **统一放宽到 50**（兑换码 + 注册码） | 2.3 定案，2.5 备选作废 |
| 管理员已读 | `admin_read_time` 共享游标 | **不做**。管理端待办信号改用「待处理」状态计数 | 删一列 + 删全部标记已读逻辑 |
| 用户已读 | `user_read_time` 时间戳 | **保留**，同时驱动侧边栏红点与列表内「管理员已回复」标记 | 不变 |
| 工单内容 | Markdown（Textarea + 编辑/预览 + `Markdown` 渲染） | **纯文本**，普通 `Textarea` 输入，`whitespace-pre-wrap` 展示 | 去掉 `Tabs`/`Markdown`，XSS 面消失 |

v2 比 v1 更小也更稳：

- 管理端待办不再依赖任何游标，而是从状态机直接派生（用户提交 → 待处理，管理员回复 → 已回复）。它天然自愈，也不会出现多个管理员互相把未读标记吃掉的问题 —— 这比 v1 的共享游标更正确，而不只是更省。
- 纯文本让用户生成内容彻底脱离 HTML 渲染路径，第 7 节原本的「用户 Markdown XSS」与「图片外链探测管理员 IP」两条风险直接归零。
- 用户侧仍保留时间戳游标：一列同时算出侧边栏未读数与每张工单的「管理员已回复」标记，不需要额外字段。


---

## 1. 需求与验收标准

### 1.1 需求 A：兑换码名称上限 20 → 50

创建兑换码时开启「福利空投」，空投活动名称直接取兑换码名称（`SyncWelfareAirdropStockForBatch` 把 `redemption.Name` 写进 `welfare_airdrops.name`），当前 20 字上限不足以表达活动标题。

验收：

1. 创建 / 更新兑换码时名称可填 1–50 个字符，按 Unicode 码点计数（中文 1 字 = 1 个），与后端 `utf8.RuneCountInString` 一致。
2. 开启福利空投后，活动名称与领取记录中的名称快照能完整保存 50 字，不被数据库截断。
3. 前端 zod 校验、表单提示文案、后端校验、后端 i18n 文案四处上限一致，不出现「前端放行、后端 400」。
4. 不需要数据库迁移，SQLite / MySQL / PostgreSQL 行为一致。

### 1.2 需求 B：工单系统

1. 开关：在系统后台「侧边栏模块」配置中开启 / 关闭，用户端与管理端各一个开关。
2. 用户端入口名为「工单反馈」，位于侧边栏「个人」分组中、「福利空投」**上方**。
3. 工单类型固定 4 种：`api调用`（默认）、`账号问题`、`账单问题`、`其他`。
4. 新增工单为弹窗表单：标题 ≤ 50 字，内容 ≤ 1000 字，**纯文本输入**（不支持 Markdown / 富文本）。
5. 用户端默认只展示自己的工单，可查看处理状态与管理员回复。
6. 管理员有独立的「工单管理」页面，可查看全部用户工单并回复。
7. 管理员回复后：用户侧边栏出现未读提示徽标；用户工单列表中该工单带「管理员已回复」标记。用户打开该工单即视为已读，两处提示同时消失。
8. 尽量复用现有组件（`Dialog`、`Sheet`、`Table`、`Select`、`Textarea`、`StatusBadge`、`SectionPageLayout` 等），不引入新依赖。

### 1.3 明确不在本次范围

Markdown / 富文本正文、附件与图片上传、邮件或 Webhook 通知、管理员已读状态与工单转派、优先级、SLA 计时、工单分类自定义、管理员内部备注。第 10 节列出演进路径。

---

## 2. 需求 A 设计：兑换码名称 20 → 50

### 2.1 现状盘点

| 位置 | 现状 | 说明 |
| --- | --- | --- |
| `controller/redemption.go:79` | `RuneCountInString(Name) == 0 \|\| > 20` | 兑换码创建校验 |
| `controller/registration_code.go:67` | 同上，且复用同一个 i18n 键 | 注册码创建校验 |
| `web/src/features/redemption-codes/constants.ts:90-95` | `REDEMPTION_VALIDATION.NAME_MAX_LENGTH: 20` | zod schema 的唯一来源 |
| `web/src/features/redemption-codes/lib/redemption-form.ts:41-44` | `.min(NAME_MIN_LENGTH).max(NAME_MAX_LENGTH)` | 兑换码与注册码共用 |
| `components/redemptions-mutate-drawer.tsx:380-388` | 写死文案 `Name for this ... (1-20 characters)` | 两条文案 |
| `i18n/locales/{en,zh-CN,zh-TW}.yaml` | `redemption.name_length` 文案写死 1-20 | 3 个文件 |

### 2.2 名称长度链路上限核对（决定是否需要迁移）

名称从兑换码流向空投，链路上最窄的列决定真实上限：

| 列 | 声明 | 容量 |
| --- | --- | --- |
| `redemptions.name` | `gorm:"index"`，未声明 size | 由 GORM 按方言推导 |
| `welfare_airdrops.name` | `type:varchar(64)` | **64 字符** ← 最窄 |
| `welfare_airdrop_claims.airdrop_name` | `type:varchar(64)` | 64 字符 |
| `service.MaxWelfareAirdropNameLength` | `= 64` | 管理端活动表单上限 |

结论：**50 ≤ 64，无需任何数据库迁移**，也无需改 `MaxWelfareAirdropNameLength`。

同时要注意一条隐含不变量：`SyncWelfareAirdropStockForBatch` 直接把兑换码名称写入 `welfare_airdrops.name`，**不经过 `ValidateWelfareAirdrop`**。因此兑换码名称上限必须永远 `≤ 64`；否则 MySQL 严格模式下会插入失败、SQLite 下会静默存入超长值。改动时用一个显式常量把这条约束固定下来，而不是散落的字面量 `50`。

实施阶段唯一需要实测的一点：MySQL 上执行 `SHOW CREATE TABLE redemptions` 确认 `name` 列宽度 ≥ 50（GORM 对带索引的无 size string 会推导出有限宽度的 varchar，正常部署下远大于 50）。

### 2.3 方案取舍：统一 50 还是「仅空投 50」（已定案：统一 50）

| 方案 | 做法 | 评价 |
| --- | --- | --- |
| **A1 ✅ 已采纳：统一 50** | 兑换码与注册码名称统一 1–50 | 只改一处常量与一处后端字面量；兑换码名称与注册码名称共用同一个 zod 字段和同一个 i18n 键，拆开需要新增键与条件文案；名称变长无副作用 |
| A2 ❌ 已否决：仅空投 50 | 非空投码保持 20，`is_airdrop=true` 时放宽到 50 | 校验规则依赖另一个字段，用户先填 30 字再关掉空投开关会突然报错；后端需要按 `IsAirdrop` 分支；zod 需要 `superRefine` |

评审结论取 **A1**：兑换码与注册码名称一律 1–50 字符。

### 2.4 改动清单（方案 A1）

**后端**

1. 新增共享常量（`common/constants.go`，与 `ItemsPerPage` 同处）：

   ```go
   // MaxRedemptionNameLength 是兑换码 / 注册码名称的字符数上限（按 Unicode 码点计）。
   // 该值必须 <= service.MaxWelfareAirdropNameLength(64)：开启福利空投时兑换码名称会被
   // SyncWelfareAirdropStockForBatch 原样写入 welfare_airdrops.name(varchar(64))，
   // 且该路径不经过 ValidateWelfareAirdrop 校验。
   const MaxRedemptionNameLength = 50
   ```

2. `controller/redemption.go:79`、`controller/registration_code.go:67` 把 `> 20` 换成 `> common.MaxRedemptionNameLength`。
3. `i18n/locales/en.yaml`、`zh-CN.yaml`、`zh-TW.yaml` 的 `redemption.name_length` 文案改为 1-50。
   - 该键同时服务兑换码与注册码，文案保持中性（例如「名称长度必须在 1-50 之间」）。

**前端**

4. `constants.ts`：`NAME_MAX_LENGTH: 50`。zod schema 与错误文案 `Name must be between {{min}} and {{max}} characters` 已经是插值实现，自动跟随。
5. `redemptions-mutate-drawer.tsx`：两条写死的 `(1-20 characters)` 文案改为插值：

   ```tsx
   t('Name for this redemption code ({{min}}-{{max}} characters)', {
     min: REDEMPTION_VALIDATION.NAME_MIN_LENGTH,
     max: REDEMPTION_VALIDATION.NAME_MAX_LENGTH,
   })
   ```

   新增两个插值键到 `web/src/i18n/locales/{en,zh}.json`，删除旧的两条固定文案键。
6. 给名称输入框加 `maxLength={REDEMPTION_VALIDATION.NAME_MAX_LENGTH}` 与字数计数，避免用户输入到 60 字才在提交时报错。
7. `web/src/i18n/static-keys.ts` 中 `'Name must be between {{min}} and {{max}} characters'` 已登记，无需改动。

### 2.5 备选方案（已作废，仅存档）

评审已确定统一放宽，本节不实施。若将来又要区分，改法是：后端 `limit := 20; if redemption.IsAirdrop { limit = common.MaxRedemptionNameLength }` 并新增 `redemption.airdrop_name_length` 键；前端把长度判断挪进 `superRefine` 依据 `data.is_airdrop` 取上限，并在 `handleAirdropToggle(false)` 里主动 `form.trigger('name')`，否则「先填长名称再关掉开关」的错误会延迟到提交时才暴露。

### 2.6 回归用例

- 50 个中文字符可创建成功；51 个中文字符被后端拒绝且错误文案显示 1-50。
- 开启空投 + 50 字名称：`welfare_airdrops.name` 与 `welfare_airdrop_claims.airdrop_name` 完整保存，领取后用户端卡片标题与领取记录都不截断。
- 注册码 50 字名称同样通过（共用校验）。
- 空名称仍被拒绝（`min = 1` 未变）。
- 后端测试建议放在 `controller` 层已有的表驱动风格里，断言 rune 计数边界（50 通过 / 51 拒绝），使用 `testify/require`。

---

## 3. 需求 B 总体架构

### 3.1 分层落点

```
model/ticket.go                     Ticket / TicketMessage 模型与数据访问
model/ticket_test.go                状态流转、未读判定回归
service/ticket.go                   校验、上限、视图组装、状态机
service/ticket_test.go              边界校验回归
controller/ticket.go                用户端 + 管理端 HTTP handler
router/api-router.go                路由注册
middleware/ticket.go                功能开关中间件（TicketWriteEnabled）
setting/sidebar_module.go           SidebarModulesAdmin 的服务端解析（可复用）
i18n/keys.go + i18n/locales/*.yaml  后端错误文案
controller/audit.go                 新增 ticket.* 审计模板

web/src/features/tickets/           用户端 + 管理端前端（同一 feature，参照 welfare-airdrop 的做法）
web/src/routes/_authenticated/tickets/index.tsx
web/src/routes/_authenticated/ticket-management/index.tsx
web/src/hooks/use-sidebar-data.ts   插入「工单反馈」「工单管理」入口 + 红点
web/src/hooks/use-sidebar-config.ts URL → 模块键映射
web/src/features/system-settings/maintenance/config.ts + sidebar-modules-section.tsx
web/src/features/profile/components/sidebar-modules-card.tsx
```

### 3.2 关键设计决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 会话建模 | 两张表：`tickets` + `ticket_messages` | 需求是「管理员回复 / 用户查看」，实际会产生追问。单字段 `reply` 无法承载多轮，后期改造要迁移数据；线程表一开始就把成本付掉 |
| 用户未读判定 | 单列读时间戳：`last_admin_reply_time > user_read_time` | 计数器方案在并发或异常路径下会漂移且无法自愈；时间戳幂等，重复标记已读无副作用。一列同时算出侧边栏未读数与列表内「管理员已回复」标记 |
| 管理端待办信号 | **不存管理员已读状态**，直接用「待处理」状态计数 | 状态机已经天然表达了待办：用户提交 / 追问 → 待处理，管理员回复 → 已回复。派生信号自愈，且不会出现多个管理员互相吃掉未读标记的问题；比共享游标更正确而不只是更省 |
| 状态取值 | `1/2/3`，不使用 0 | 与 `WelfareAirdropStatus`、`RedemptionCodeStatus` 一致，避免零值歧义（Go 零值与「待处理」混淆） |
| 时间字段 | `int64` Unix 秒 | 与 `WelfareAirdrop`、`SensitiveWordViolation` 等既有表一致，跨三种数据库无时区歧义 |
| 开关来源 | 复用 `SidebarModulesAdmin` 选项 | 需求指定「在侧边栏菜单配置中选择是否打开」；新增独立 `TicketEnabled` 选项会出现两个真相来源 |
| 服务端 gate | 写接口受开关约束，读接口不受 | 关闭功能后已提交的工单仍要能被双方看到，否则会话被孤立；只堵住新增/追问即可达到「关掉」的效果 |
| 前端目录 | 单一 `features/tickets/`，内含管理端组件 | 与 `features/welfare-airdrop/`（`index.tsx` + `admin-campaigns.tsx`）一致，避免类型 / 常量跨 feature 复制 |
| 正文格式 | **纯文本**：`Textarea` 输入，`whitespace-pre-wrap` 展示 | 用户生成内容完全不进入 HTML 渲染路径，靠 React 默认转义即安全，XSS 与图片外链探测风险从设计上消除。**禁止**用 `Markdown` / `RichContent` / `HtmlContent` 渲染工单正文 |
| 通知机制 | 轮询（60s）+ 变更后主动失效 | 项目没有 WebSocket / SSE 基础设施，为红点引入长连接不划算；`user-ranking` 已有 `refetchInterval` 先例 |

---

## 4. 数据模型

### 4.1 `tickets`

```go
// TicketStatus 取值沿用「1 启用 / 2 停用」式的非零约定，避免 Go 零值与业务状态混淆。
const (
    TicketStatusPending = 1 // 待处理：用户已提交或已追问，等待管理员响应
    TicketStatusReplied = 2 // 已回复：管理员已回复，等待用户确认或追问
    TicketStatusClosed  = 3 // 已关闭：不再接受新消息
)

// TicketType 是工单分类，固定 4 种，不支持自定义。
const (
    TicketTypeAPICall = 1 // api调用
    TicketTypeAccount = 2 // 账号问题
    TicketTypeBilling = 3 // 账单问题
    TicketTypeOther   = 4 // 其他
)

// TicketAuthorRoleUser / Admin 标识一条消息的发送方身份。
const (
    TicketAuthorRoleUser  = 1 // 由提单用户发出
    TicketAuthorRoleAdmin = 2 // 由管理员发出
)
```

```go
// Ticket 描述一张用户提交的工单。工单本身只保存元信息与会话游标，
// 正文与每一次回复都存在 ticket_messages 中（首条消息即用户提交的工单内容）。
// 表名：tickets
type Ticket struct {
    Id       int    `json:"id" gorm:"primaryKey;autoIncrement"`                                    // 主键，自增 ID
    UserId   int    `json:"user_id" gorm:"not null;index:idx_ticket_user_updated"`                  // 提单用户 ID，与 UpdatedTime 组成联合索引用于「我的工单」按更新时间倒序分页
    Username string `json:"username" gorm:"type:varchar(64);not null;default:'';index"`             // 提单时的用户名快照，用户改名或注销后管理端列表仍可读
    Type     int    `json:"type" gorm:"not null;index"`                                            // 工单类型，取 TicketType* 之一；默认 TicketTypeAPICall
    Title    string `json:"title" gorm:"type:varchar(191);not null"`                               // 工单标题，业务上限 50 个字符（按 Unicode 码点计），列宽留余量以容纳 4 字节字符
    Status   int    `json:"status" gorm:"not null;index:idx_ticket_status_reply"`                   // 工单状态，取 TicketStatus*；升序即「待处理 → 已回复 → 已关闭」，可直接用于排序
    // MessageCount 是会话内消息总数（含用户提交的首条），由回复事务原子自增，用于列表展示与 MaxTicketMessages 上限判定。
    MessageCount int `json:"message_count" gorm:"not null;default:0"`
    // LastAdminReplyTime 是最后一条管理员消息的时间（Unix 秒）；0 表示管理员从未回复。
    // 与 UserReadTime 比较即得出用户是否有未读回复，是「管理员已回复」标记与侧边栏红点的唯一数据来源。
    LastAdminReplyTime int64 `json:"last_admin_reply_time" gorm:"bigint;not null;default:0"`
    // LastReplyTime 是最后一条消息（不区分发送方）的时间（Unix 秒），仅用于列表排序与展示，
    // 避免把排序建立在跨方言行为不一致的表达式上。
    LastReplyTime int64 `json:"last_reply_time" gorm:"bigint;not null;index:idx_ticket_status_reply"`
    // UserReadTime 是提单用户最后一次打开该工单详情的时间（Unix 秒）。
    // 用户未读 <=> LastAdminReplyTime > UserReadTime，该判定幂等，重复标记已读无副作用。
    // 有意不设对应的管理员已读列：管理端待办由 Status = TicketStatusPending 直接派生。
    UserReadTime int64 `json:"user_read_time" gorm:"bigint;not null;default:0"`
    ClosedTime    int64 `json:"closed_time" gorm:"bigint;not null;default:0"`  // 关闭时间（Unix 秒），0 表示未关闭；重开时清零
    CreatedTime   int64 `json:"created_time" gorm:"bigint;not null"`           // 工单创建时间（Unix 秒）
    UpdatedTime   int64 `json:"updated_time" gorm:"bigint;not null;index:idx_ticket_user_updated"` // 最后一次变更时间（Unix 秒），任何消息或状态变化都会刷新
}

func (Ticket) TableName() string { return "tickets" }
```

### 4.2 `ticket_messages`

```go
// TicketMessage 是工单会话中的一条消息。首条消息（AuthorRole = user，序号最小）即
// 用户提交工单时填写的正文，后续为管理员回复与用户追问，按 Id 升序即会话顺序。
// 表名：ticket_messages
type TicketMessage struct {
    Id         int    `json:"id" gorm:"primaryKey;autoIncrement"`                                  // 主键，自增 ID
    TicketId   int    `json:"ticket_id" gorm:"not null;index:idx_ticket_message_thread"`           // 所属工单 ID（对应 tickets 主键），单列索引用于定位会话
    UserId     int    `json:"user_id" gorm:"not null;default:0"`                                   // 消息发送者的用户 ID；管理员回复时为该管理员的 ID
    Username   string `json:"username" gorm:"type:varchar(64);not null;default:''"`                // 发送者用户名快照，账号变更后历史会话仍可读
    AuthorRole int    `json:"author_role" gorm:"not null"`                                         // 发送方身份，取 TicketAuthorRole*；决定前端气泡左右与「管理员」标签
    Content    string `json:"content" gorm:"type:text;not null"`                                   // 消息正文，纯文本；保留换行、不解析任何标记语言，业务上限 1000 个字符（按 Unicode 码点计）
    CreatedTime int64 `json:"created_time" gorm:"bigint;not null"`                                 // 发送时间（Unix 秒），仅用于展示；秒级精度不足以单独决定会话顺序
}

func (TicketMessage) TableName() string { return "ticket_messages" }
```

**会话顺序按 `Id` 而不是 `CreatedTime`**：`created_time` 是 Unix 秒，同一秒内写入的两条消息若按时间排序，顺序在不同数据库、不同执行计划下并不稳定。自增主键天然单调，`ORDER BY id ASC` 才是权威顺序；单工单消息上限 100 条，`ticket_id` 单列索引定位会话后按 `id` 排序的代价可忽略，因此不再建 `(ticket_id, created_time)` 复合索引。

### 4.3 状态机

```
                 用户提交
                    │
                    ▼
              ┌───────────┐  管理员回复   ┌───────────┐
              │  待处理    │ ───────────► │  已回复    │
              │  Pending  │ ◄─────────── │  Replied  │
              └───────────┘   用户追问    └───────────┘
                    │                          │
        用户/管理员关闭│                          │用户/管理员关闭
                    ▼                          ▼
                        ┌───────────┐
                        │  已关闭    │ ──── 管理员重开 ──► 待处理
                        └───────────┘
```

规则：

- 用户创建工单 → `Pending`，`LastReplyTime = CreatedTime`，`UserReadTime = CreatedTime`（自己写的不算未读）。
- 管理员回复 → `Replied`，刷新 `LastAdminReplyTime`、`LastReplyTime`、`UpdatedTime`。此刻用户侧未读成立（`LastAdminReplyTime > UserReadTime`），侧边栏徽标与列表标记同时出现。
- 用户打开工单详情 → `UserReadTime = now`，两处提示消失。全系统只有这一处写 `UserReadTime`。
- 用户追问 → 回到 `Pending`，刷新 `LastReplyTime`、`UpdatedTime`，并把 `UserReadTime` 推到当前时间（能追问必然已看过回复，顺手清掉残留未读）。
- `Closed` 状态下双方都不能再发消息（服务端在更新条件里拦截）。
- **重开只允许管理员**：避免用户反复复活旧工单绕过「未关闭工单数上限」。重开时 `ClosedTime = 0`，状态回到 `Pending`。
- 管理端没有任何「标记已读」写操作 —— 待办队列就是 `Status = Pending` 的集合，管理员一回复该工单自动离队。
- 管理员状态更新接口（`PUT /admin/:id/status`）只承载两种语义：**关闭**（`Pending` / `Replied` → `Closed`）与**重开**（`Closed` → `Pending`）。其余目标流转（例如把 `Replied` 直接改回 `Pending`）一律拒绝并返回 `ticket.status_invalid`，避免绕过「重开只从关闭态出发」的语义。
- 重复关闭一张已关闭的工单是**幂等成功**：不刷新 `updated_time`、不写审计；对非关闭态执行重开则拒绝。这样多管理员并发点「关闭」不会互相报错，而非法流转仍然被拦。

### 4.4 提示语义与查询

用户侧一条读游标，管理端零游标：

| 场景 | 判定 | 呈现位置 |
| --- | --- | --- |
| 某工单「管理员已回复」标记 | `last_admin_reply_time > user_read_time` | 用户端工单列表行内徽标 |
| 用户未读工单数 | `SELECT COUNT(*) FROM tickets WHERE user_id = ? AND last_admin_reply_time > user_read_time` | 侧边栏「工单反馈」徽标 |
| 管理端待办数 | `SELECT COUNT(*) FROM tickets WHERE status = 1` | 侧边栏「工单管理」徽标 + 管理端统计条 |

前两条是同一个条件的「单条」与「聚合」两种用法 —— 一列 `user_read_time` 同时满足需求中的两处提示，不需要额外字段。

两列比较的 `WHERE` 在 SQLite / MySQL / PostgreSQL 上语法一致，用 GORM 链式写法即可：

```go
// 用户未读工单数
DB.Model(&Ticket{}).
    Where("user_id = ? AND last_admin_reply_time > user_read_time", userId).
    Count(&count)

// 管理端待办数：纯状态计数，可直接命中 idx_ticket_status_reply 的前缀
DB.Model(&Ticket{}).Where("status = ?", TicketStatusPending).Count(&count)
```

用户侧那条两列比较无法走索引，但先由 `user_id` 收敛（单用户工单量级是个位数到几十），代价可忽略；列表接口顺便在同一次查询里把每行的标记算出来，不额外发请求。管理端那条是单列等值，索引直接命中。

**秒级游标的已知边界**：管理员回复与用户标记已读落在同一秒时，`last_admin_reply_time > user_read_time` 不成立，红点与「管理员已回复」标记不会出现（消息本身仍在会话里可见）。这是 1 秒窗口内的显示级偏差，不影响数据正确性，接受它；要彻底消除需把两列改成毫秒精度，与全表「Unix 秒」约定不一致，不值得。详情接口的实现顺序固定为「先加载会话消息，再以加载完成后的当前时间写 `user_read_time`」，确保本次已经返回给用户看的回复一定被判定为已读。

### 4.5 排序策略

列表默认排序：`Order("status ASC, last_reply_time DESC, id DESC")`。

`status` 升序天然等于「待处理 → 已回复 → 已关闭」，因此不需要 `CASE WHEN`，避免跨方言的排序表达式差异 —— 这是把状态取值定为 `1/2/3` 的额外收益。索引 `idx_ticket_status_reply(status, last_reply_time)` 直接命中。

### 4.6 迁移与跨库兼容

- 在 `model/main.go` 的 `migrateDB()` 与 `migrateDBFast()` 两处都追加 `&Ticket{}`、`&TicketMessage{}`（`migrateDBFast` 还要在 `migrations` 切片里补 `{&Ticket{}, "Ticket"}`、`{&TicketMessage{}, "TicketMessage"}`）。漏掉 fast 分支会导致开启快速迁移的部署缺表。
- 全部走 `AutoMigrate` + `ALTER TABLE ... ADD COLUMN` 语义，无 `ALTER COLUMN`，SQLite 可用。
- 主键交给 GORM，不写 `AUTO_INCREMENT` / `SERIAL`。
- 无 bool 列，因此不涉及 `gorm:"default:true"` 在 MySQL / PostgreSQL 上被规范化成不同默认值、导致每次启动重复 `ALTER TABLE` 的问题。
- 没有保留字列名（避开了 `group`、`key`），无需 `commonGroupCol` / `commonKeyCol`。
- 全部为 GORM 链式查询，无原生 SQL，无需 `common.UsingMainDatabase` 分支。

### 4.7 写操作的并发安全

回复 / 追问在一个事务内完成「读工单 → 校验 → 插消息 → 更新游标」：

```go
DB.Transaction(func(tx *gorm.DB) error {
    ticket := &Ticket{}
    if err := lockForUpdate(tx).First(ticket, "id = ?", id).Error; err != nil { ... }
    // 归属（用户端强制 user_id 相符）、状态、消息数上限校验
    ...
    if err := tx.Create(message).Error; err != nil { return err }

    updates := map[string]interface{}{
        "message_count":   gorm.Expr("message_count + ?", 1),
        "last_reply_time": now,
        "updated_time":    now,
    }
    if authorRole == TicketAuthorRoleAdmin {
        updates["status"] = TicketStatusReplied
        updates["last_admin_reply_time"] = now // 用户侧未读由此成立
    } else {
        updates["status"] = TicketStatusPending // 重新进入管理端待办队列
        updates["user_read_time"] = now         // 追问顺带清掉残留未读
    }

    result := tx.Model(&Ticket{}).
        Where("id = ? AND status <> ?", id, TicketStatusClosed).
        Updates(updates)
    if result.Error != nil { return result.Error }
    if result.RowsAffected != 1 { return ErrTicketClosed } // 并发关闭时整体回滚
    return nil
})
```

要点：

- 锁必须用 `model/locking.go` 的 `lockForUpdate(tx)`（MySQL / PostgreSQL 发 `FOR UPDATE`，SQLite 跳过），**不要**用 GORM v1 的 `tx.Set("gorm:query_option", "FOR UPDATE")`（v2 会静默忽略），也不要在调用点重复写 `clause.Locking`。
- `UPDATE` 的 `WHERE` 里再带一次 `status <> closed`，用 `RowsAffected` 兜住「读到未关闭、写时已被关闭」的竞态。
- 计数用 `gorm.Expr("message_count + ?", 1)` 而非读后回写。

**创建 / 关闭 / 重开 / 删除同样有并发与原子性要求**（4.7 不能只覆盖回复这一条路径）：

- **创建**：`CreateTicket` 也走事务：先 `lockForUpdate(tx).First(&user, userId)` 锁住提单用户的 `users` 行，把同一用户的新建串行化，再检查未关闭数与当日新建数，最后在同一事务内写 `tickets` 与首条 `ticket_messages`（`MessageCount = 1`）。不锁用户行时，双击提交或多端并发提交会让两个请求都读到「4 < 5」然后各插一条，绕过上限；SQLite 跳过行锁，但其单写者模型天然串行，同样安全。
- **关闭**：条件更新 `WHERE id = ? AND user_id = ? AND status <> closed`，靠 `RowsAffected` 判断；为 0 说明已经是关闭态，按幂等成功处理（不刷 `updated_time`、不写审计），与 4.3 的规则一致。
- **重开**：条件更新 `WHERE id = ? AND status = closed`，`RowsAffected = 0` 返回 `ticket.status_invalid`，防止并发重复重开或对未关闭工单重开。
- **删除**：事务内先 `DELETE FROM ticket_messages WHERE ticket_id = ?` 再 `DELETE FROM tickets WHERE id = ?`，两条写同生共死，避免留下查不到父工单的孤儿消息。

标记已读是幂等的单条更新，不需要事务，且**只有用户端存在这个动作**：

```go
DB.Model(&Ticket{}).Where("id = ? AND user_id = ?", id, userId).
    Update("user_read_time", now)
```

管理员打开工单详情是纯读操作，不写任何状态 —— 这是「不做管理员已读」带来的直接收益：管理端详情接口没有副作用，可以随意重试、预取、并发打开。

---

## 5. 后端接口

### 5.1 路由表

在 `router/api-router.go` 中按既有 `welfare-airdrop` 的写法注册两个分组：

```go
ticketRoute := apiRouter.Group("/ticket")
ticketRoute.Use(middleware.UserAuth())
{
    ticketRoute.GET("/self", controller.GetSelfTickets)
    ticketRoute.GET("/self/unread", controller.GetSelfTicketUnread)
    ticketRoute.GET("/self/:id", controller.GetSelfTicket)
    ticketRoute.POST("/", middleware.TicketWriteEnabled(), middleware.UserCriticalRateLimit("ticket"), controller.CreateTicket)
    ticketRoute.POST("/self/:id/reply", middleware.TicketWriteEnabled(), middleware.UserCriticalRateLimit("ticket"), controller.ReplySelfTicket)
    ticketRoute.POST("/self/:id/close", controller.CloseSelfTicket)
}

ticketAdminRoute := apiRouter.Group("/ticket/admin")
ticketAdminRoute.Use(middleware.AdminAuth())
{
    ticketAdminRoute.GET("", controller.GetAllTickets)
    ticketAdminRoute.GET("/stats", controller.GetTicketStats)
    ticketAdminRoute.GET("/:id", controller.GetTicketDetail)
    ticketAdminRoute.POST("/:id/reply", controller.ReplyTicket)
    ticketAdminRoute.PUT("/:id/status", controller.UpdateTicketStatus)
    ticketAdminRoute.DELETE("/:id", controller.DeleteTicket)
}
```

**路由命名说明**：保持 `/self/:id` 与 `/admin/:id` 的布局即可。两点澄清：其一，gin 自 v1.7 起支持同层静态段与参数段共存（本仓库为 v1.9.1，已实测 `/ticket/self`、`/ticket/admin` 与 `/ticket/:id` 可同时注册，且静态段优先匹配），「注册 `/ticket/:id` 会 panic」是过时说法，不要据此做设计决策；其二，仍然不注册 `/ticket/:id`——用户端详情统一收在 `/self/:id` 下，与 `welfare-airdrop` 的 `/claim/:id`、`/admin/:id` 布局一致，权限边界从路径上就可见。同理 `/self/unread` 与 `/self/:id` 并存也是合法的（静态优先），但注意 `:id` 解析失败要按「不存在」返回而不是 500。

### 5.2 请求 / 响应约定

沿用 `common.ApiSuccess` / `common.ApiError` / `common.ApiErrorI18n`，响应体 `{success, message, data}`。分页统一用 `common.GetPageQuery(c)` + `pageInfo.SetTotal/SetItems`（`page_size` 已在该 helper 内被限制到 100），与 `GetAllRedemptions` 完全一致，前端拿到 `{items, total, page, page_size}`。

请求体解析统一用 `common.DecodeJson(c.Request.Body, &req)`（禁止直接 `encoding/json`）。

主要 DTO（`service/ticket.go` 中定义视图类型，模型不直接外泄）：

```go
// TicketListItemView 是工单列表中的一行。UnreadReply 由后端算好，前端不重复实现判定规则。
type TicketListItemView struct {
    Id            int    `json:"id"`
    UserId        int    `json:"userId"`
    Username      string `json:"username"`      // 仅管理端返回，用户端置空
    Type          int    `json:"type"`
    Title         string `json:"title"`
    Status        int    `json:"status"`
    MessageCount  int    `json:"messageCount"`
    UnreadReply   bool   `json:"unreadReply"`   // 仅用户端使用：管理员已回复且用户尚未查看，驱动「管理员已回复」标记；管理端恒为 false
    LastReplyTime int64  `json:"lastReplyTime"`
    CreatedTime   int64  `json:"createdTime"`
}

// TicketMessageView 是会话中的一条消息。
type TicketMessageView struct {
    Id          int    `json:"id"`
    AuthorRole  int    `json:"authorRole"`
    Username    string `json:"username"`
    Content     string `json:"content"`     // 纯文本，含换行；前端用 whitespace-pre-wrap 原样展示
    CreatedTime int64  `json:"createdTime"`
}

// TicketDetailView 是工单详情：元信息 + 完整会话。
type TicketDetailView struct {
    TicketListItemView
    Messages []TicketMessageView `json:"messages"`
    CanReply bool                `json:"canReply"` // 综合状态、开关、消息数上限判定，前端据此禁用输入
    CanClose bool                `json:"canClose"`
}
```

`CanReply` / `CanClose` 由后端判定并下发，前端只负责渲染 —— 与 `WelfareAirdropView.CanClaim` 的做法一致，避免前后端两套规则漂移。

两个补充契约：

- `POST /api/ticket/` 成功时 `data` 直接返回新工单的 `TicketDetailView`（含 `id` 与首条消息）。前端「提交成功后自动打开新工单详情」依赖这个返回值，不要靠刷新列表再反查。
- 列表查询参数：用户端 `/self` 支持 `status`、`type` + 分页；管理端 `/admin` 支持 `status`、`type`、`keyword`（标题或用户名模糊）、`user`（填数字按 `user_id` 精确，否则按 `username` 精确）、`start_time` / `end_time`（按 `created_time` 过滤）+ 分页。全部走 query string，与 `GetAllRedemptions` 的既有习惯一致。

管理端统计接口 `GET /api/ticket/admin/stats` 返回按状态分组的计数，其中 `pending` 同时供侧边栏徽标使用：

```go
// TicketStatsView 是管理端的工单概览。pending 即待办队列长度，无需任何已读游标。
type TicketStatsView struct {
    Pending int64 `json:"pending"` // 待处理
    Replied int64 `json:"replied"` // 已回复
    Closed  int64 `json:"closed"`  // 已关闭
    Total   int64 `json:"total"`
}
```

### 5.3 校验与上限

集中在 `service/ticket.go`：

```go
const (
    MaxTicketTitleLength   = 50   // 工单标题字符数上限（Unicode 码点）
    MaxTicketContentLength = 1000 // 单条消息字符数上限（Unicode 码点）
    MaxTicketOpenPerUser   = 5    // 单用户同时未关闭的工单数上限
    MaxTicketPerUserPerDay = 10   // 单用户每日新建工单数上限
    MaxTicketMessages      = 100  // 单个工单的消息总数上限
)
```

校验规则：

| 字段 | 规则 | 失败返回 |
| --- | --- | --- |
| `type` | 必须是 4 个常量之一；缺省（0）归一化为 `TicketTypeAPICall` | `ticket.type_invalid` |
| `title` | `TrimSpace` 后 `1 <= RuneCount <= 50` | `ticket.title_length` |
| `content` | 换行归一化 + `TrimSpace` 后 `1 <= RuneCount <= 1000` | `ticket.content_length` |
| 未关闭工单数 | `< MaxTicketOpenPerUser` | `ticket.open_limit` |
| 当日新建数 | `< MaxTicketPerUserPerDay` | `ticket.daily_limit` |
| 消息总数 | `< MaxTicketMessages` | `ticket.message_limit` |
| 工单归属 | 用户端所有 `/self/*` 接口都必须带 `user_id = c.GetInt("id")` 条件 | `ticket.not_found`（不泄漏「存在但不属于你」） |
| 已关闭 | 关闭态拒绝回复 | `ticket.closed` |
| 管理员状态更新 | 仅允许关闭（`Pending`/`Replied` → `Closed`）与重开（`Closed` → `Pending`）；重复关闭幂等成功 | `ticket.status_invalid` |

注意事项：

- 长度一律用 `utf8.RuneCountInString`，与需求「50 字 / 1000 字」的中文语义一致；用 `len()` 会让中文只能填 1/3。
- **换行归一化**：入库前把 `\r\n` 与孤立 `\r` 统一成 `\n`。Windows 浏览器提交的 `Textarea` 内容是 CRLF，不归一化会让每个换行吃掉 2 个码点，导致同一段文字在不同系统上「有的能提交、有的超限」，且前端字数计数与后端不一致。
- 正文按纯文本原样入库、原样返回，后端**不做** HTML 转义或标记清洗 —— 转义由前端 React 默认行为承担。若将来把工单内容外发到 HTML 场景（如邮件通知），必须在那一层单独转义，不能依赖存储层。
- 用户端查询越权防护采用「查不到」而非「无权限」，避免通过错误码探测工单是否存在。
- 每日新建数按 `created_time >= 当日零点` 统计。零点按服务器本地时区计算，与 `UserRedemptionLog` 按 `YYYY-MM-DD` 归集的既有做法保持同一时区语义即可，不引入新的时区配置。
- 上述上限都是防滥用而非计费乘数，因此不涉及 `AGENTS.md` 中的额度饱和 / `common.QuotaFromFloat` 那套约束；工单链路完全不触碰额度。

### 5.4 限流

创建与用户追问挂 `middleware.UserCriticalRateLimit("ticket")`（已存在，按用户 ID 计数，代理换 IP 无效）。管理员回复不限流。

### 5.5 审计

管理员的写操作走 `recordManageAudit`，并在 `controller/audit.go` 的 `auditContentTemplates` 中登记英文兜底模板：

```go
"ticket.reply":         "Replied to ticket #${id} of user ${username}",
"ticket.status_update": "Changed ticket #${id} status to ${status}",
"ticket.delete":        "Deleted ticket #${id} of user ${username}",
```

用户自己关闭工单不是高危操作，不写审计。

### 5.6 后端 i18n

在 `i18n/keys.go` 新增一段，并在 `i18n/locales/en.yaml`、`zh-CN.yaml`、`zh-TW.yaml` 三个文件补齐同名键（缺任一语言会回落成键名裸露给用户）：

```go
// Ticket related messages
const (
    MsgTicketDisabled      = "ticket.disabled"
    MsgTicketNotFound      = "ticket.not_found"
    MsgTicketTypeInvalid   = "ticket.type_invalid"
    MsgTicketTitleLength   = "ticket.title_length"
    MsgTicketContentLength = "ticket.content_length"
    MsgTicketClosed        = "ticket.closed"
    MsgTicketOpenLimit     = "ticket.open_limit"
    MsgTicketDailyLimit    = "ticket.daily_limit"
    MsgTicketMessageLimit  = "ticket.message_limit"
    MsgTicketStatusInvalid = "ticket.status_invalid"
)
```

### 5.7 功能开关的服务端实现

`SidebarModulesAdmin` 目前只存在 `common.OptionMap` 里，由前端解析（`controller/misc.go:111` 原样下发），后端没有类型化视图。新增一个可复用的解析器：

```go
// setting/sidebar_module.go  (package setting)

// IsSidebarModuleEnabled 判断 SidebarModulesAdmin 中某个 section.module 是否开启。
// 该选项只在管理员保存设置时变化，因此按原始字符串做一次性缓存，避免每个请求都解析 JSON。
// 选项为空或解析失败时返回 true，与前端 parseSidebarModulesAdmin 的「回落到默认全开」一致。
func IsSidebarModuleEnabled(section string, module string) bool
```

实现要点：

- 读 `common.OptionMap["SidebarModulesAdmin"]` 时持 `common.OptionMapRWMutex.RLock()`。
- JSON 解析必须用 `common.UnmarshalJsonStr`，禁止直接 `encoding/json`。
- 用 `sync.RWMutex` + `lastRaw string` 缓存解析结果，raw 变化时重算。
- 判定逻辑与前端 `isModuleEnabled` 对齐：`section.enabled == true && section[module] == true` 才算开启；**这里只做管理员层，用户个人的 `sidebar_modules` 收窄不参与服务端 gate**（它是个人显示偏好，不是权限）。

中间件：

```go
// middleware/ticket.go

// TicketWriteEnabled 在管理员关闭工单模块时拦截新建 / 追问。
// 只拦产生新内容的写接口：读接口与关闭保持开放，这样关闭功能后双方仍能查看并收尾已有会话，
// 不会把在途工单变成谁都看不到的孤儿数据。
func TicketWriteEnabled() func(c *gin.Context)
```

命中关闭时返回 `common.ApiErrorI18n(c, i18n.MsgTicketDisabled)` 并 `c.Abort()`。注意「只拦产生新内容的写接口」是刻意取舍：新建与追问被挡住即达到关闭效果；用户关闭自己的在途工单、双方查看历史会话都保持可用，与服务端「读开放」的语义自洽。

管理端接口不加该中间件：管理员需要在关闭功能后把队列里的存量工单处理完。

---

## 6. 前端设计

### 6.1 目录结构

```
web/src/features/tickets/
├── index.tsx                              用户端页面 <TicketFeedback />
├── admin.tsx                              管理端页面 <TicketManagement />
├── api.ts                                 用户端 + 管理端请求函数、queryKeys
├── types.ts                                zod schema + 类型
├── constants.ts                            类型/状态枚举（labelKey 形式）、校验常量、消息文案键
├── lib/ticket-form.ts                      getTicketFormSchema(t)、默认值、payload 变换
├── hooks/
│   ├── use-ticket-unread.ts                用户未读数（供侧边栏）
│   └── use-ticket-admin-stats.ts           管理端待办数（供侧边栏 + 统计条）
├── components/
│   ├── ticket-create-dialog.tsx            「新增工单」弹窗
│   ├── ticket-list.tsx                     用户端列表（桌面 Table / 移动卡片）
│   ├── ticket-detail-sheet.tsx             用户端详情抽屉
│   ├── ticket-thread.tsx                   会话气泡列表（用户端 / 管理端共用）
│   ├── ticket-composer.tsx                 纯文本回复输入框 + 字数计数（追问与回复共用）
│   ├── ticket-status-badge.tsx             状态徽标（包 StatusBadge）
│   ├── ticket-type-label.tsx               类型文案
│   ├── admin-ticket-filters.tsx            管理端筛选栏
│   ├── admin-ticket-table.tsx              管理端表格
│   └── admin-ticket-detail-sheet.tsx       管理端详情抽屉（含回复、关闭/重开、删除）
└── __tests__/                              见第 8 节
```

单一 feature 承载两端，参照 `features/welfare-airdrop/`（`index.tsx` + `admin-campaigns.tsx`），避免 `types.ts` / `constants.ts` 跨 feature 复制。单文件超 200 行时按 `web/AGENTS.md` 3.3 继续拆分。

### 6.2 路由

```
web/src/routes/_authenticated/tickets/index.tsx            → /tickets            component: TicketFeedback
web/src/routes/_authenticated/ticket-management/index.tsx  → /ticket-management  component: TicketManagement
```

管理端路由加角色守卫，与 `redemption-codes/index.tsx` 完全同构：

```tsx
export const Route = createFileRoute('/_authenticated/ticket-management/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()
    if (!auth.user || auth.user.role < ROLE.ADMIN) {
      throw redirect({ to: '/403' })
    }
  },
  validateSearch: ticketManagementSearchSchema,  // page / pageSize / status / type / keyword
  component: TicketManagement,
})
```

用户端路由用 `validateSearch` 承接 `page`、`status`、`type`，以及可选的 `ticket`（zod `coerce.number().int().positive().optional()`，即 6.4 的 `?ticket=<id>` 详情恢复参数），保证筛选状态可分享、刷新不丢。新增路由后 `routeTree.gen.ts` 由 TanStack Router 插件在 `bun run dev` / `build` 时重新生成，不手改。

### 6.3 侧边栏改动

**（1）入口与位置** —— `web/src/hooks/use-sidebar-data.ts`，`personal` 分组插到「福利空投」之前：

```tsx
{
  title: t('Profile'),
  url: '/profile',
  icon: User,
},
{
  title: t('Ticket Feedback'),
  url: '/tickets',
  icon: LifeBuoy,
  badge: ticketUnread > 0 ? String(ticketUnread) : undefined,   // default 色调，计数语义
},
{
  title: t('Welfare Airdrop'),
  url: '/welfare-airdrop',
  icon: Gift,
  badge: t('Limited time'),
  badgeTone: 'attention',
},
```

`admin` 分组追加：

```tsx
{
  title: t('Ticket Management'),
  url: '/ticket-management',
  icon: Inbox,
  badge: ticketPending > 0 ? String(ticketPending) : undefined,
},
```

图标从 `lucide-react` 取 `LifeBuoy` / `Inbox`（`Ticket` 已被「兑换码」占用，避免语义撞车）。`badgeTone` 留默认 —— `attention` 是留给限时促销的暖色渐变脉冲，未读计数用中性 primary pill 更合适（见 `nav-group.tsx` 的 `NavBadge` 注释）。

**（2）红点数据源** —— `use-ticket-unread.ts`：

```ts
export function useTicketUnread(): number {
  const isVisible = useIsSidebarModuleVisible('/tickets')   // 已存在，复用
  const user = useAuthStore((s) => s.auth.user)
  const query = useQuery({
    queryKey: ticketQueryKeys.unread,
    queryFn: getSelfTicketUnread,
    enabled: Boolean(user) && isVisible,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })
  return query.data ?? 0
}
```

- `enabled` 守卫必须有：`useSidebarData()` 也被 `command-menu.tsx` 调用，且会在鉴权就绪前渲染，未登录时不能发请求。
- 两个调用点共用同一 `queryKey`，React Query 缓存去重，不会重复拉取。
- 打开工单详情（服务端标记已读）与提交追问后，`invalidateQueries({ queryKey: ticketQueryKeys.unread })`，红点即时消失，不等下一次轮询。
- 管理端 `use-ticket-admin-stats.ts` 同构，`enabled` 追加 `role >= ROLE.ADMIN`；它取的是 `stats.pending`（待处理计数），不涉及任何已读状态。因此管理员打开工单看一眼不会改变角标 —— 只有真正「回复」才会让工单离开待办队列，这正是共享收件箱想要的行为。

**（3）开关配置** —— 需要同步四处，漏掉任一处会出现「配置里能关但侧边栏不听」或反之：

| 文件 | 改动 |
| --- | --- |
| `features/system-settings/maintenance/config.ts` | `SIDEBAR_MODULES_DEFAULT.personal.ticket = true`、`.admin.ticket = true` |
| `hooks/use-sidebar-config.ts` | `DEFAULT_SIDEBAR_MODULES` 同步加两个键；`URL_TO_CONFIG_MAP` 加 `'/tickets' → {personal, ticket}`、`'/ticket-management' → {admin, ticket}` |
| `features/system-settings/maintenance/sidebar-modules-section.tsx` | `moduleMeta.personal.ticket`、`moduleMeta.admin.ticket` 的标题与描述（否则回落成 `toTitleCase` 的机翻式英文） |
| `features/profile/components/sidebar-modules-card.tsx` | `sectionDefs` 的 `personal.modules` 加 `ticket`（用户个人收窄开关；该卡片只暴露 chat/console/personal，管理端不需要） |

两处 `ticket` 键名相同但分属 `personal` / `admin` section，互不影响 —— 这正是现有两层配置结构的用法。

`mergeWithDefaultSidebarModules` / `parseSidebarModulesAdmin` 会把新键合并进历史配置并默认 `true`，所以**存量部署升级后工单默认开启**，无需数据迁移。若希望默认关闭，把两处默认值改成 `false` 即可（但要注意 `isModuleEnabled` 对未映射 URL 默认放行，务必同时补 `URL_TO_CONFIG_MAP`）。

### 6.4 用户端页面 `/tickets`

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 工单反馈                                              [ + 新增工单 ]       │
├───────────────────────────────────────────────────────────────────────────┤
│ 状态 [全部 ▾]   类型 [全部 ▾]                              [刷新]          │
├───────────────────────────────────────────────────────────────────────────┤
│ 标题                                   类型      状态     最后更新         │
│ API 报错 429 一直重试 [管理员已回复]   api调用   已回复   09-04 14:22   >  │
│ 账单对不上，请核对                     账单问题  待处理   09-03 09:10   >  │
│ 忘记绑定邮箱                           账号问题  已关闭   08-28 17:41   >  │
├───────────────────────────────────────────────────────────────────────────┤
│                                        共 3 条   ‹  1 / 1  ›               │
└───────────────────────────────────────────────────────────────────────────┘
```

- 外壳 `SectionPageLayout`（`SectionPageLayout.Title` + `.Content`），与 `sensitive-word-violations`、`welfare-airdrop` 一致。
- **「管理员已回复」标记**：`unreadReply === true` 时在标题右侧渲染一个 `Badge`（`variant='success'` 或主题色），并给整行加浅色底。文字徽标是主要信息载体，底色只是辅助 —— 颜色不能是唯一线索（可访问性）。这是需求「工单页面对应的工单有个标记管理员回复了」的落点。
- 打开该工单详情后标记消失（后端写 `user_read_time`），刷新列表时该行恢复普通样式。
- 桌面用 `Table`；`< sm` 断点切换为堆叠卡片列表，参照 `redemption-codes/components/redemptions-mobile-list.tsx`。
- 分页复用 `@/components/ui/pagination` 组件族（`Pagination` / `PaginationContent` / `PaginationPrevious` / `PaginationNext`）。
- 空态：无工单时展示引导文案 + 「新增工单」按钮，而不是空表格。
- **「新增工单」按钮的显隐用管理员级开关**：从 `use-sidebar-config.ts` 导出 `useIsAdminSidebarModuleVisible('/tickets')`（只解析 `status.SidebarModulesAdmin`，不叠加用户个人偏好层），与服务端 `TicketWriteEnabled` 的判定同源。不要复用 `useIsSidebarModuleVisible`——它叠加了个人收窄层，个人隐藏侧边栏的用户直接输入 URL 访问时会被误禁新增，而服务端实际是允许的。管理员关闭模块后，直接访问 `/tickets` 仍能看到存量工单（读开放），但没有新增入口。
- 点击行打开 `Sheet` 详情，URL 同步 `?ticket=<id>`，便于刷新后仍停在同一工单。

### 6.5 新增工单弹窗

用 `Dialog`（需求明确是「点击新增工单弹出来的」）。表单 `react-hook-form` + `zodResolver`，schema 放 `lib/ticket-form.ts`：

```ts
const runeLength = (value: string) => [...value].length

export function getTicketFormSchema(t: TFunction) {
  const msg = getTicketFormErrorMessages(t)
  return z.object({
    type: z.number().int().refine((v) => TICKET_TYPE_VALUES.includes(v), msg.TYPE_INVALID),
    title: z
      .string()
      .trim()
      .refine((v) => runeLength(v) >= 1 && runeLength(v) <= TICKET_VALIDATION.TITLE_MAX_LENGTH, msg.TITLE_LENGTH),
    content: z
      .string()
      .transform((v) => v.replaceAll('\r\n', '\n').trim()) // 与后端换行归一化保持一致
      .refine((v) => runeLength(v) >= 1 && runeLength(v) <= TICKET_VALIDATION.CONTENT_MAX_LENGTH, msg.CONTENT_LENGTH),
  })
}

export const TICKET_FORM_DEFAULT_VALUES = {
  type: TICKET_TYPE.API_CALL, // 需求指定默认「api调用」
  title: '',
  content: '',
}
```

> 长度校验刻意用 `refine([...v].length)` 而不是 `.max()`：zod 的 `.max()` 数的是 UTF-16 code unit，后端数的是 Unicode 码点。BMP 内字符（含全部中文）两者一致，但 emoji 与部分生僻字是代理对，`.max()` 会让用户提前 1 个字被拦。用码点计数才能和后端完全对齐，也符合「50 字就是 50 个字」的直觉。

```
┌───────────────────────────── 新增工单 ──────────────────────────────┐
│ 提交后我们会尽快回复，可在工单列表中查看处理进度。                    │
│                                                                     │
│ 工单类型 *                                                          │
│ [ api调用                                                       ▾ ] │
│                                                                     │
│ 工单标题 *                                            12 / 50       │
│ [ API 报错 429 一直重试                                           ] │
│                                                                     │
│ 工单内容 *                                           238 / 1000     │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ 调用 gpt-4o 时持续返回 429，已确认额度充足。                     │ │
│ │ 请求 ID：req_01H...，时间约 09-03 20:50。                        │ │
│ │                                                                 │ │
│ │ 换行会被原样保留。                                               │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│ 请描述具体现象、发生时间和请求 ID，便于我们定位。                     │
│                                                     [取消] [ 提交 ] │
└─────────────────────────────────────────────────────────────────────┘
```

字段与复用组件：

| 字段 | 组件 | 说明 |
| --- | --- | --- |
| 工单类型 | `Select` + `SelectItem` × 4 | 默认 `api调用`。选 `Select` 而非 `ToggleGroup`：4 个中文选项在窄屏 `ToggleGroup` 里会挤压换行，且筛选栏也用 `Select`，两处一致 |
| 工单标题 | `Input`，`maxLength=50` | 右上角实时字数 `12 / 50`，超限前就有反馈 |
| 工单内容 | `Textarea`（`rows≈10`），`maxLength=1000` | **纯文本**。不做编辑/预览切换，不引入 `Tabs`，不引入 `Markdown` —— 输入即最终呈现，用户不需要学任何语法 |

- 字数计数用 `[...value].length`（码点计数），与后端 `utf8.RuneCountInString` 对齐；`maxLength` 属性数的是 UTF-16 code unit，对 BMP 内字符（含全部中文）两者一致，仅 emoji 会略严，方向安全。
- 提交前把 `\r\n` 归一化成 `\n` 再计数与发送，避免 Windows 换行让计数和后端对不上（后端也会再归一化一次，双端一致）。
- 提交成功：`toast.success` + 关闭弹窗 + `invalidateQueries(ticketQueryKeys.list)`，并自动打开新工单详情。
- 提交失败：`handleServerError` 统一处理；后端字段级错误（标题/内容超限）映射到对应字段用 `form.setError` 展示在字段下方。

### 6.6 会话线程与回复框

`ticket-thread.tsx`（两端共用）：

```
┌─────────────────────────────────────────────────────────────────┐
│ #128  API 报错 429 一直重试              [api调用]   已回复       │
│ 提交人 alice · 2026-09-03 21:07 · 共 2 条消息                    │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────┐               │
│  │ [用户] alice · 09-03 21:07                   │               │
│  │ 调用 gpt-4o 时持续返回 429，已确认额度充足。  │               │
│  │ 请求 ID：req_01H...                          │               │
│  └──────────────────────────────────────────────┘               │
│               ┌──────────────────────────────────────────────┐  │
│               │ [管理员] bob · 09-04 14:22                   │  │
│               │ 已为你调整分组限速，请重试。                  │  │
│               └──────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│ 补充说明                                            0 / 1000    │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │                                                             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                    [ 关闭工单 ]  [ 提交回复 ]    │
└─────────────────────────────────────────────────────────────────┘
```

- 容器：`Sheet` + `sideDrawerContentClassName()` / `sideDrawerHeaderClassName()` / `sideDrawerFooterClassName()`（`@/components/drawer-layout`），与 `redemptions-mutate-drawer.tsx` 同一套壳。
- 气泡布局**固定**：用户消息靠左、管理员消息靠右，用户端与管理端完全一致，不随观看者视角翻转。翻转会让同一条消息在两个页面位置相反，用户截图与管理员看到的对不上。
- 每条消息都带角色文字标签 `[用户]` / `[管理员]`（`Badge`），身份不依赖位置或颜色传达。
- 正文渲染：`<p className='whitespace-pre-wrap break-words'>{message.content}</p>`。React 默认转义，纯文本原样呈现并保留换行。**不要**引入 `Markdown` / `RichContent` / `dangerouslySetInnerHTML`。
- `break-words`（或 `[overflow-wrap:anywhere]`）是必须的：用户会粘贴超长请求 ID 与 URL，不换行会把抽屉撑出横向滚动条。
- `canReply === false` 时（已关闭 / 达到消息上限 / 功能已关闭）：`Textarea` 与提交按钮 `disabled`，并显示具体原因文案，而不是静默禁用。
- `ticket-composer.tsx` 被用户追问与管理员回复共用，差异只是提交的 API 与成功后失效的 queryKey，通过 props 传入。
- 打开详情即调用详情接口，用户端顺带写 `user_read_time`；成功后 `invalidateQueries(ticketQueryKeys.unread)` 与列表 key，让侧边栏徽标和行内标记立即消失。管理端详情无副作用。
- 便利项（建议做）：每条消息右上角一个「复制」按钮，复用已有的 `use-copy-to-clipboard`。纯文本下 URL 不可点击，一键复制是成本最低的补偿。

### 6.7 管理端页面 `/ticket-management`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 工单管理                                                                  │
├──────────────────────────────────────────────────────────────────────────┤
│  待处理 12       已回复 34       已关闭 108       合计 154                 │
├──────────────────────────────────────────────────────────────────────────┤
│ 用户[        ] 关键词[        ] 状态[全部▾] 类型[全部▾]                    │
│ 开始[      ] 结束[      ]        [搜索] [刷新] [重置]                     │
├──────────────────────────────────────────────────────────────────────────┤
│ ID   用户    类型      标题             状态     消息  最后回复            │
│ 128  alice   api调用   API 报错 429…    待处理    3    09-04 14:22   >     │
│ 127  bob     账单问题  账单对不上        已回复    2    09-03 09:10   >     │
│ 126  carol   其他      文档链接失效      已关闭    4    08-28 17:41   >     │
├──────────────────────────────────────────────────────────────────────────┤
│                                        共 154 条   ‹  1 / 8  ›            │
└──────────────────────────────────────────────────────────────────────────┘
```

- 统计条数据来自 `GET /api/ticket/admin/stats`，其中「待处理」即待办队列长度，同时驱动侧边栏角标。没有「未读」这一格 —— 管理端不存已读状态。
- 筛选栏结构完全对齐 `sensitive-word-violations/components/sensitive-word-triggers-tab.tsx`：`Input` + `DatePicker` + `Select` + 搜索/刷新/重置三按钮，`Enter` 触发搜索。搜索条件收敛到一个 `filters` state 后再触发查询，避免每次输入都请求。
- 默认排序 = `status ASC, last_reply_time DESC, id DESC`，待处理天然排在最前，管理员从上往下清队列即可。
- 待处理行给整行浅色底（`bg-warning/5` 之类）作为视觉锚点。**不额外加「新」徽标** —— 状态列已经写着「待处理」，再加一个徽标是同一信息说两遍。
- 关键词同时匹配标题与用户名（后端两个字段 `LIKE ... OR ...`）。用户列支持填 ID 或用户名。
- 点击行打开 `admin-ticket-detail-sheet.tsx`：`ticket-thread` + 回复框 + 底部操作区。打开动作无副作用，不改任何状态。
- 底部操作：`关闭工单` / `重新打开`（按当前状态二选一）、`删除工单`。删除走二次确认 `Dialog`，文案明确「将永久删除该工单及全部会话记录，不可恢复」—— 与 `sensitive-word-triggers-tab` 的清除确认同风格。
- 所有变更 `onSuccess` 后失效 `ticketQueryKeys.adminList`、`adminStats`、以及该工单的 detail key；回复成功后该工单状态变「已回复」，会自动从待处理筛选视图中消失，待办计数同步 -1。

### 6.8 复用组件清单（不新增依赖）

| 用途 | 复用 |
| --- | --- |
| 页面外壳 | `@/components/layout` → `SectionPageLayout` |
| 新增弹窗 / 删除确认 | `@/components/ui/dialog` |
| 详情抽屉 | `@/components/ui/sheet` + `@/components/drawer-layout` |
| 表单 | `@/components/ui/form` + `react-hook-form` + `zod` + `@hookform/resolvers/zod` |
| 输入 | `@/components/ui/input`、`@/components/ui/textarea`、`@/components/ui/select` |
| 复制消息正文 | `@/hooks/use-copy-to-clipboard` |
| 状态徽标 | `@/components/status-badge` → `StatusBadge`（`success` / `warning` / `neutral`） |
| 标签 | `@/components/ui/badge` |
| 表格 | `@/components/ui/table` |
| 分页 | `@/components/ui/pagination` |
| 日期筛选 | `@/components/date-picker` |
| 提示 | `sonner` 的 `toast` |
| 错误处理 | `@/lib/handle-server-error` → `handleServerError` |
| 时间格式化 | `@/lib/format` → `formatTimestampToDate` |
| 图标 | `lucide-react`（`LifeBuoy`、`Inbox`、`Plus`、`Search`、`RefreshCw`、`RotateCcw`、`Trash2`、`Send`） |

### 6.9 前端 i18n

- 组件内一律 `const { t } = useTranslation()` + `t('English source string')`；子组件即使父级已有也自行调用（`web/AGENTS.md` 3.1）。
- `constants.ts` 里的类型 / 状态用 `labelKey` 形式，组件中 `t(config.labelKey)`；成功 / 错误消息常量只存 i18n 键，展示时必须包 `t()`。
- 因为类型 / 状态标签是运行时传入 `t()` 的动态值，正则扫不到，必须在 `web/src/i18n/static-keys.ts` 新增一段登记（见附录 B）。
- 补齐 `web/src/i18n/locales/en.json` 与 `zh.json`，执行 `bun run i18n:sync` 校验。

### 6.10 可访问性

- 未读状态不只用颜色：圆点旁配「新回复」文本徽标。
- 表单每个控件用 `FormLabel` 关联；字数计数用 `aria-live="polite"` 播报接近上限。
- 抽屉打开时焦点进入首个可交互元素，关闭后回到触发行；`Sheet` / `Dialog` 组件已内置焦点陷阱。
- 装饰性图标加 `aria-hidden="true"`；纯图标按钮加 `aria-label`。
- 正文输入是单个纯文本 `Textarea`，没有编辑 / 预览切换（v2 已移除 `Tabs`）；实现时不要因为这条清单里曾出现过「预览」字样而把页签加回来。`Textarea` 自身的键盘滚动与焦点行为已满足要求。

---

## 7. 安全

| 风险 | 处置 |
| --- | --- |
| 越权读写他人工单 | 用户端每个查询 / 更新都强制拼 `user_id = c.GetInt("id")`；查不到统一返回「工单不存在」，不区分「无权限」 |
| 用户输入 XSS（管理员是受害面） | **设计上已消除**：正文按纯文本经 `whitespace-pre-wrap` 渲染，走 React 默认转义，全链路没有 HTML 解析环节。**禁止**引入 `Markdown` / `RichContent` / `HtmlContent` / `dangerouslySetInnerHTML` 渲染工单正文 |
| 外链图片探测管理员 IP | **设计上已消除**：纯文本不会自动加载任何远程资源，粘贴的 URL 连超链接都不会生成 |
| 刷工单 / 刷回复 | `UserCriticalRateLimit("ticket")` + 未关闭工单数上限 + 每日新建上限 + 单工单消息数上限，四层叠加 |
| 超长文本打爆数据库 | 标题 / 内容在 service 层按码点硬校验，`content` 为 `text` 列但业务上限 1000 字 |
| 关闭功能后仍可提交 | `TicketWriteEnabled()` 中间件做服务端 gate，不依赖前端隐藏菜单 |
| 用户名快照泄漏 | 管理端列表才返回 `username`，用户端视图置空 |

工单链路完全不接触额度与计费，因此 `AGENTS.md` 中额度饱和 / `common.QuotaFromFloat` / `PriceData.AddOtherRatio` 相关约束不适用；反过来说，**不要**在工单里加任何直接改额度的动作（例如「一键补偿额度」），那会把一个纯文本模块拉进计费不变量的约束范围。若将来确有需求，必须走现有的用户额度调整接口并复用其审计与饱和保护。

---

## 8. 测试计划

遵循 `AGENTS.md`「后端测试质量」与 `web/AGENTS.md` 3.14：只保护真实契约与回归路径，不写只证明代码能跑的用例；后端用 `testify/require`（致命断言）+ `assert`（值断言），前端用 Vitest + React Testing Library，测试放在模块专属 `__tests__/`。

**后端 `model/ticket_test.go`**

- 标记语义：`last_admin_reply_time > user_read_time` 为真时列表 `UnreadReply=true`；用户打开详情后转为 false；重复标记已读结果不变（幂等）。
- 状态流转：创建→待处理、管理员回复→已回复、用户追问→待处理、关闭→已关闭、管理员重开→待处理。
- 管理端待办计数：管理员打开详情**不改变** `status = 待处理` 的计数；回复后该工单离队、计数 -1。这条直接保护「不做管理员已读」这个决策。
- 已关闭工单回复被拒绝，且 `RowsAffected` 兜底生效（事务内先被并发关闭再回复时整体回滚，消息不落库）。
- 消息数上限：达到 `MaxTicketMessages` 后再回复被拒。
- 同一秒写入的两条消息按 `Id` 升序返回，会话顺序不因秒级时间戳而乱序（保护 4.2 的排序决策）。

**后端 `service/ticket_test.go`**（表驱动，显式输入与期望）

- 标题：0 字拒绝、50 个中文通过、51 个中文拒绝。
- 内容：1000 个中文通过、1001 拒绝。
- 换行归一化：`"a\r\nb"` 入库为 `"a\nb"`；由 500 个 `\r\n` 组成的输入按 `\n` 计数后不超限（若不归一化会被误判 1000+）。
- 类型：`0` 归一化为 `api调用`；`5` 拒绝。
- 未关闭工单数达 `MaxTicketOpenPerUser` 后新建被拒；关闭一个后可再建。
- 每日新建数达 `MaxTicketPerUserPerDay` 后新建被拒；跨天后计数重置。
- 管理员状态更新：关闭 `Pending` / `Replied` 成功；重开仅 `Closed` 成功，对 `Replied` 重开被拒；重复关闭幂等成功且不写审计。
- 越权：用户 A 读 / 回复用户 B 的工单返回「不存在」而非「无权限」。

**后端 `setting`**

- `IsSidebarModuleEnabled`：空选项 → true；`{"personal":{"enabled":false,"ticket":true}}` → false；`{"personal":{"enabled":true,"ticket":false}}` → false；非法 JSON → true（回落全开，与前端一致）。

**前端 `web/src/features/tickets/__tests__/`**

- `ticket-create-dialog.test.tsx`：打开弹窗时类型默认「api调用」；标题超 50 提交被拦并在字段下显示错误；内容超 1000 同理；合法提交调用创建接口且 payload 含 `type/title/content`，且其中的 `\r\n` 已归一化为 `\n`。
- `ticket-thread.test.tsx`：多行正文的换行被保留（断言 `whitespace-pre-wrap` 的容器渲染出原始文本，含 `\n`）；输入 `<script>alert(1)</script>` 时页面上出现的是这段**字面文本**而不是脚本节点（保护「纯文本、不解析标记」这个契约）；`canReply=false` 时输入与提交按钮 `disabled` 且展示具体原因文案；用户与管理员消息各自带可访问的角色名称。
- `ticket-unread-badge.test.tsx`：`unread=0` 时侧边栏无徽标；`unread=3` 时徽标文本为 `3`；未登录时不发请求（`enabled` 守卫）。
- `ticket-list.test.tsx`：空态渲染引导文案与「新增工单」按钮；`unreadReply=true` 的行含「管理员已回复」**文本**徽标（不只靠颜色）；打开该工单后重新拉取的列表里该徽标消失。
- `admin-ticket-table.test.tsx`：默认待处理排在前；关键词搜索仅在点击搜索 / 回车后触发一次请求；统计条不含「未读」一格。

---

## 9. 交付分期与验证

| 阶段 | 内容 | 可独立上线 |
| --- | --- | --- |
| P0 | 需求 A：名称 20 → 50（后端常量 + 3 个 yaml + 前端常量 + 2 条插值文案 + 计数） | 是 |
| P1 | `model/ticket.go` + 迁移（两处 AutoMigrate）+ model 测试 | 是（无入口） |
| P2 | `service/ticket.go` + `controller/ticket.go` + 路由 + i18n + 审计模板 + 限流 + `setting/sidebar_module.go` + `middleware/ticket.go` | 是（无入口） |
| P3 | 前端用户端：feature 骨架、列表、新增弹窗、详情抽屉、路由 | 是 |
| P4 | 前端管理端：统计条、筛选、表格、详情抽屉、回复/关闭/删除、路由 | 是 |
| P5 | 侧边栏四处配置 + 红点 hooks + 位置调整 | 是 |
| P6 | 测试补齐 + i18n sync + typecheck / lint / build | — |

每阶段的验证命令：

```bash
# 后端
go build ./...
go test ./model/... ./service/... ./setting/... ./controller/...
go vet ./...

# relaykit 独立性（本设计不触碰 relaykit，仅在误改时需要）
cd relaykit && GOWORK=off go build ./...

# 前端
cd web
bun install
bun run typecheck
bun run lint
bun run test
bun run i18n:sync
bun run build
```

三种数据库都要过一遍首次迁移：SQLite（默认）、MySQL、PostgreSQL，确认 `tickets` / `ticket_messages` 建表成功，且**重启第二次不再产生 `ALTER TABLE`**（验证没有引入会反复漂移的默认值）。

---

## 10. 已知取舍与后续演进

**本次有意接受的简化**

1. 管理端完全没有已读状态：管理员无法标记「看过但先不回」。要暂存只能真的回复一句，或另建流程。**这是评审决定，不是遗漏。**
2. 用户未读靠 60s 轮询 + 操作后主动失效，不是实时推送；最坏延迟 60 秒。
3. 无通知：管理员回复后用户只能在下次访问站点时看到徽标，没有邮件 / Telegram 提醒。
4. 正文纯文本：不能排版、不能贴图，粘贴的 URL 不可点击（用每条消息的「复制」按钮补偿）。
5. 无附件上传。
6. 工单类型硬编码 4 种，增减需要发版。
7. 未读判定基于秒级时间戳：管理员回复与用户已读发生在同一秒时，红点可能不出现，消息本身不受影响（见 4.4 的边界说明）。

**演进路径（按性价比排序）**

1. **邮件通知**：管理员回复时给提单用户发信。项目已有 SMTP 配置与发信能力，改动集中在 `service/ticket.go` 一处，不动数据模型。注意正文进 HTML 邮件模板时必须在那一层转义（见 5.3）。
2. **自动链接化**：只把 `http(s)://` 开头的 token 渲染成 `<a target="_blank" rel="noopener noreferrer">`，其余仍是纯文本节点。这是「纯文本」与「链接可点」之间成本最低的折中 —— 不引入 Markdown 解析器，也不打开 HTML 注入面。
3. **附件上传**：接入项目已有的文件上传权限体系（`FileUploadPermission`），`ticket_messages` 加 `attachments` TEXT 列存 JSON 数组。
4. **管理员维度已读**：团队规模变大后若确有需要，新增 `ticket_admin_reads(ticket_id, admin_id, read_time)` 即可。当前设计没有任何字段阻碍这一步，纯加表，不改既有语义。
5. **实时推送**：需要引入 SSE / WebSocket 基础设施，成本远高于收益，除非站点整体引入实时通道。
6. **富文本正文**：若将来要加，渲染层换成 `Markdown` 组件即可（DOMPurify 已内置），但会把 XSS 与图床探测两条风险重新引入，必须重做安全评审 —— 不要当成一次纯 UI 改动。
7. **工单类型可配置**：迁到配置表或 `Option`，但需求明确「目前仅支持四个类型」，暂不设计。

---

## 附录 A：完整字段速查

**tickets**

| 列 | 类型 | 索引 | 含义 |
| --- | --- | --- | --- |
| `id` | int PK | — | 主键 |
| `user_id` | int | `idx_ticket_user_updated` | 提单用户 |
| `username` | varchar(64) | 单列 | 用户名快照 |
| `type` | int | 单列 | 1 api调用 / 2 账号 / 3 账单 / 4 其他 |
| `title` | varchar(191) | — | 标题，业务上限 50 码点 |
| `status` | int | `idx_ticket_status_reply` | 1 待处理 / 2 已回复 / 3 已关闭 |
| `message_count` | int | — | 会话消息总数 |
| `last_admin_reply_time` | bigint | — | 最后一条管理员消息时间，0=从未回复；与 `user_read_time` 比较即得未读 |
| `last_reply_time` | bigint | `idx_ticket_status_reply` | 最后一条消息时间，排序与展示用 |
| `user_read_time` | bigint | — | 用户已读游标（全表唯一的已读字段，无管理员对应列） |
| `closed_time` | bigint | — | 关闭时间，0=未关闭 |
| `created_time` | bigint | — | 创建时间 |
| `updated_time` | bigint | `idx_ticket_user_updated` | 最后变更时间 |

**ticket_messages**

| 列 | 类型 | 索引 | 含义 |
| --- | --- | --- | --- |
| `id` | int PK | — | 主键 |
| `ticket_id` | int | `idx_ticket_message_thread`（单列） | 所属工单；会话内按 `id` 升序读取 |
| `user_id` | int | — | 发送者 |
| `username` | varchar(64) | — | 发送者用户名快照 |
| `author_role` | int | — | 1 用户 / 2 管理员 |
| `content` | text | — | 消息正文，纯文本（保留换行），业务上限 1000 码点 |
| `created_time` | bigint | — | 发送时间（Unix 秒），仅用于展示，不决定会话顺序 |

---

## 附录 B：i18n 键清单

**后端 `i18n/locales/{en,zh-CN,zh-TW}.yaml`**

```yaml
ticket.disabled:        工单功能当前未开启
ticket.not_found:       工单不存在
ticket.type_invalid:    无效的工单类型
ticket.title_length:    工单标题长度必须在 1-50 之间
ticket.content_length:  工单内容长度必须在 1-1000 之间
ticket.closed:          该工单已关闭，无法继续回复
ticket.open_limit:      您有过多未关闭的工单，请先处理已有工单
ticket.daily_limit:     今日新建工单数已达上限，请明天再试
ticket.message_limit:   该工单消息数已达上限，请新建工单继续反馈
ticket.status_invalid:  无效的工单状态
# 需求 A 同时修改：
redemption.name_length: 名称长度必须在 1-50 之间
```

**前端 `web/src/i18n/locales/{en,zh}.json` 新增（英文原文作为键）**

导航与页面：`Ticket Feedback`、`Ticket Management`、`New Ticket`、`My Tickets`、`Ticket Details`

字段与提示：`Ticket Type`、`Ticket Title`、`Ticket Content`、`Submit Reply`、`Close Ticket`、`Reopen Ticket`、`Delete Ticket`、`Add a note…`、`Copy`、`Admin replied`、`No tickets yet`、`Submit your first ticket and we will get back to you.`、`Describe the symptom, when it happened and the request ID so we can locate it.`、`This ticket is closed and no longer accepts replies.`、`This ticket has reached its message limit.`、`Ticket submitted successfully`、`Reply submitted successfully`、`Ticket closed`、`Ticket reopened`、`Ticket deleted`、`This will permanently delete this ticket and all of its messages. This cannot be undone.`

插值：`Title must be between {{min}} and {{max}} characters`、`Content must be between {{min}} and {{max}} characters`、`{{current}} / {{max}}`

需求 A 新增插值键（替换原两条固定文案）：`Name for this redemption code ({{min}}-{{max}} characters)`、`Name for this registration code ({{min}}-{{max}} characters)`

> `Other`、`Closed`、`Cancel`、`Delete`、`Status`、`User` 等通用词在现有 locale 文件里可能已存在，`bun run i18n:sync` 会提示重复，不要重复添加。

**`web/src/i18n/static-keys.ts` 新增段落**（运行时传入 `t()` 的动态标签，正则扫不到）

```ts
  // Tickets — types, statuses and dynamic messages
  'API Calls',
  'Account Issue',
  'Billing Issue',
  'Other',
  'Pending',
  'Replied',
  'Closed',
  'Admin replied',
  'Ticket submitted successfully',
  'Reply submitted successfully',
  'Ticket closed',
  'Ticket reopened',
  'Ticket deleted',
  'Title must be between {{min}} and {{max}} characters',
  'Content must be between {{min}} and {{max}} characters',
```

键本身是英文源串，中文译文写在 `zh.json` 里。四个类型的中文译文固定为 `api调用`、`账号问题`、`账单问题`、`其他`（`API Calls` → `api调用`）；三个状态为 `待处理`、`已回复`、`已关闭`；`Admin replied` → `管理员已回复`。
