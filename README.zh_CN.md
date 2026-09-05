<div align="center">

# Hog API Gateway

🍥 **基于 New API 二次开发的新一代大模型网关与AI资产管理系统**

<p align="center">
  简体中文 |
  <a href="./README.md">English</a>
</p>

<p align="center">
  <a href="#-快速开始">快速开始</a> •
  <a href="#-主要特性">主要特性</a> •
  <a href="#-最近更新">最近更新</a> •
  <a href="#-部署">部署</a> •
  <a href="#-文档">文档</a>
</p>

</div>

> 本项目基于 [new-api](https://github.com/QuantumNous/new-api) 二次开发，遵循 AGPLv3 协议，感谢原作者 [QuantumNous](https://github.com/QuantumNous) 及社区贡献者。

## 📝 项目说明

> [!IMPORTANT]
> - 本项目仅面向合法授权的 AI API 网关、组织内部鉴权、多模型管理、用量统计、成本核算和私有化部署场景。
> - 使用者必须合法取得上游 API Key、账号、模型服务或接口权限，并遵守上游服务条款及适用法律法规。
> - 使用者应确保其使用方式符合上游服务条款及适用法律法规。
> - 面向公众提供生成式人工智能服务时，使用者应遵守[《生成式人工智能服务管理暂行办法》](http://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm)等监管要求，自行完成所在司法辖区要求的备案、许可、内容安全、实名、日志留存、税务和上游授权等合规义务。

---

## 🆕 最近更新

> 以下均为本仓库在上游版本基础上**新增或优化**的功能——不移除、不替换上游既有能力。

### ✨ 新增功能

<div align="center">

![Hog API Gateway Banner](https://img2.leileihog.top/vLogo/hog-gateway.png)

</div>

**🛡️ 风控与安全**

- **🚨 测活防护（Probe Guard）** —— 检测并拦截「短时间跨模型批量测活」行为：按用户统计滑动窗口内请求的**去重模型数**，超过阈值即判定为批量测活，可按配置执行警告（HTTP 403 + 专属错误码）、自动封禁（失效全部会话与令牌）或观察模式（DryRun 只记日志不拦截）。检测窗口、模型数阈值、允许触发次数均可配置；支持管理员、指定分组与用户 ID 白名单豁免；无 Redis 部署自动回退单机内存实现；风控组件故障时不阻断正常转发。
- **🧭 风控中心** —— 原「敏感词触发」管理页升级为双 Tab 布局：「敏感词触发」Tab 保留原有全部功能；新增「测活名单」Tab 按用户聚合展示测活触发记录（测活次数、最近测试的模型、最近触发 IP 与时间、自动标注高/中/低风险徽章），展开可查看每条触发明细（IP、动作、去重模型数与清单、User-Agent），并支持重置计数、封禁、删除记录与一键清空观察记录。
- **🎫 注册码（Registration Code）** —— 管理员可批量生成一次性注册码，并在系统设置中开启「注册码必填」以控制新用户注册准入。与兑换码体系相互独立：密码注册与 OAuth 注册通道全部接入校验（消费失败自动回滚刚创建的用户；微信通道无法携带注册码，开启校验后禁止微信创建新用户，已有账号登录不受影响）；注册表单带防抖实时预校验（区分无效/已使用/已过期）；管理端支持搜索、编辑、启用/禁用、软删、批量复制、导出 TXT、批量禁用与一键清理无效注册码。
- **🚫 条件封禁用户** —— 用户管理页「添加用户」旁新增「条件封禁」按钮，可按**上次登录时间**或**最近 API 调用时间**批量封禁满足条件的用户（预设 3/7/15/30 天前，或自定义精确到分钟的时间），封禁效果与单独封禁一致：置为禁用、提升 `auth_version` 使旧会话与令牌失效、清理令牌缓存。
- **📝 手动封禁原因** —— 手动禁用用户时新增封禁原因弹窗：内置「批量测活」「批量邀请小号」「多次触发违禁词」「破限或违禁信息」四种预设原因，也支持自定义（最长 255 字符）。被封禁用户登录时会看到按当前语言本地化的原因提示；重新启用用户时自动清空封禁原因。
- **🌐 用户列表新增「登录 IP」列** —— 在「上次登录」列后新增「登录 IP」列，展示该用户**最近一次成功登录所使用的 IP**，覆盖密码 / 2FA / Passkey / OAuth / 微信 / Telegram 全部登录方式；完整的多次登录 IP 历史仍保留在既有的登录审计日志中。
- **📍 用户注册来源追踪** —— 记录每个用户的注册渠道（密码注册、管理员创建、微信、GitHub / Discord / OIDC / LinuxDO / Telegram / 自定义 OAuth），用户表格新增「注册来源」列，存量用户按第三方账号绑定情况自动回填。
- **📊 用户排名（IP 统计）** —— 管理员侧边栏新增「用户排名」页面，基于 API 消耗日志按用户统计历史去重 IP 数、近 10 分钟去重 IP 数与 API 调用次数，支持「今日 / 近 3 天」时间维度，按去重 IP 数降序返回 Top 50 并每 30 秒自动刷新。

**🔍 敏感词管理增强**

- **🖍️ 命中高亮与定位** —— 违规详情弹窗将请求内容按命中词切分为片段高亮展示，命中词以红色 Badge 列出，支持「定位命中词」循环跳转并平滑滚动，实时显示「第 x/y 处命中 / 共命中 n 处」；请求内容不再通过悬浮预览，仅在详情弹窗中揭示，避免泄漏。
- **👥 按用户聚合视图** —— 敏感词违规管理页重构为按用户聚合的主表（违规次数、触发次数、是否重点、最近违规时间），点击展开查看该用户违规明细（分页、查看完整请求内容），展开区内保留重置计数与封禁操作。
- **🗑️ 违规记录批量删除** —— 支持按选中 ID、按天数（1–36500 天）或自定义截止时间批量清理违规记录，并返回实际删除条数。
- **🔎 筛选与管理增强** —— 支持按用户（用户名或用户 ID）、起止日期及「仅重点」筛选；详情请求内容一键复制；支持按用户清零累计触发次数（同时清除历史重点标记）。
- **🚪 过滤分组豁免** —— 系统安全设置新增排除分组多选项，属于这些用户分组的请求跳过敏感词过滤，全局过滤开关仍保持生效。

**🎁 运营与营销**

- **🪂 福利空投（Welfare Airdrop）** —— 类似「自动发卡」的限时额度发放功能：管理员创建空投活动（单份额度、总库存、起止时间窗口、用户分组），每个用户限领 1 次、不会重复领取；用户在「福利空投」页面轮播查看进行中/即将开始的活动并一键领取，可查看最近领取记录（兑换码可复制）；与兑换码批次联动，创建/删除/启停空投码时自动同步活动库存，避免「幽灵库存」；整个领取流程在单事务内完成（校验、原子扣减库存、占用空投码、入账、记充值日志），SQLite 下亦竞态安全。
- **🎰 浮梦引光（Lottery）** —— 玩法类似九宫格的幸运抽奖游戏：页头导航新增「浮梦引光」入口（可在系统设置中开关），按奖项权重加权随机开奖，每个奖项支持每日份数限制（0 表示不限），每用户每个业务日限抽 1 次；中奖记录与剩余次数实时可查；后台「引光游戏设置」可新增/编辑/删除/开关奖项、配置权重与每日份数，并支持配置展示字段。
- **📄 兑换码批量导出 TXT** —— 兑换码管理页多选后，批量操作栏新增「导出」按钮，将选中兑换码的 `key` 逐行导出为 `.txt` 文件（文件名含选中数量），便于离线分发或备份。
- **⏸️ 兑换码批量停用** —— 批量操作栏新增「批量停用所选兑换码」，仅对启用中的码执行停用并统计成功/失败数。
- **🔁 每用户每日限兑换一次额度码（可开关）** —— 系统设置 → 通用设置新增「每用户每天仅限兑换一次额度码」开关。开启后，同一已登录用户每天只能成功兑换 1 张额度码（不论批次），再次兑换返回 `redeem.daily_limit_reached`；关闭后恢复可多次兑换。默认关闭，保存即生效，无需重启。

**🧩 界面与体验**

- **🐙 GitHub 仓库链接** —— 登录后应用顶栏与公共页头部新增带 Tooltip 的 GitHub 图标按钮。
- **🧪 通道测试输入展示** —— 渠道测试弹窗新增可展开的「测试输入」面板，按端点类型展示实际发送的提示词、嵌入文本、图像提示词及重排查询/文档，便于管理员核对测试请求内容。

### 🔧 优化功能

- **🎯 OAuth 按钮改版** —— 登录/注册页第三方登录按钮由整宽纵向文字按钮改为横向排列的 44px 图标方块按钮，Tooltip 显示提供商名称，无图标提供商显示名称首字母，并补充 `aria-label` / `title` 无障碍属性。
- **🧾 登录表单布局** —— 替代登录方式（Passkey / 微信 / OAuth）统一固定展示在账号密码表单下方，不再根据登录方式组合切换位置。
- **🔊 播报管理** —— 系统设置中新建播报插入到列表顶部（而非尾部），操作列右对齐。
- **📐 空投活动管理布局** —— 改为撑满 Tab 内容区、内部纵向滚动的容器，替换原固定宽度卡片式布局。
- **🔕 会话过期提示去重** —— 401 会话过期时「Session expired!」提示改为会话周期内只弹一次，避免并发请求失败导致重复弹窗；刷新令牌成功后重置该标记。
- **🔍 敏感词整词匹配（英文）** —— 对纯 ASCII 字母/数字/下划线组成的敏感词（如 `hi`、`hello`）改为整词匹配，避免误伤 `this`、`which`、`machine`、`pinterest` 等普通英文单词；中文等非纯 ASCII 敏感词仍按子串匹配。
- **📢 全局播报展示重构** —— `broadcast_enabled` 为 `false` 时不再渲染（此前始终显示）；仅一条播报时静态显示，不再无限复制重复；多条播报改为**垂直轮播**（每条停留 10 秒、向上滑入切换），超长文本在行内横向滚动且速度自适应；类型状态圆点与文字严格垂直居中对齐。
- **🧪 通道测试默认输入调整** —— Chat（OpenAI）、Responses、Claude、Gemini 的默认测试内容由 `hi` 改为 `In the most concise way, tell me what month it is now.`，嵌入测试由 `hello world` 改为 `What day is it today?`，使后台通道测试不再被自身发送的 `hi`/`hello` 敏感词规则误拦，同时保留对真实测活请求的拦截能力。

### 🔄 其他改动

- **🌐 界面语言精简** —— 前端界面语言精简为**简体中文**与**英文**两种，移除繁体中文、法语、日语、俄语、越南语。

---

## 🚀 快速开始

### 使用 Docker Compose（推荐）

```bash
# 克隆项目
git clone https://github.com/Mr-Groundhog/hog-api-gateway.git
cd hog-api-gateway

# 编辑 docker-compose.yml 配置
nano docker-compose.yml

# 启动服务
docker-compose up -d
```

<details>
<summary><strong>使用 Docker 命令</strong></summary>

```bash
# 拉取最新镜像
docker pull leileihog/hog-new-api:latest

# 使用 SQLite（默认）
docker run --name new-api -d --restart always \
  -p 3000:3000 \
  -e TZ=Asia/Shanghai \
  -v ./data:/data \
  leileihog/hog-new-api:latest

# 使用 MySQL
docker run --name new-api -d --restart always \
  -p 3000:3000 \
  -e SQL_DSN="root:123456@tcp(localhost:3306)/oneapi" \
  -e TZ=Asia/Shanghai \
  -v ./data:/data \
  leileihog/hog-new-api:latest
```

> **💡 提示：** `-v ./data:/data` 会将数据保存在当前目录的 `data` 文件夹中，你也可以改为绝对路径如 `-v /your/custom/path:/data`

</details>

---

🎉 部署完成后，访问 `http://localhost:3000` 即可使用！

> [!WARNING]
> 将本项目作为面向公众的生成式 AI 服务或 API 转售服务运营时，使用者应先完成备案、内容安全、实名、日志留存、税务、支付和上游授权等合规义务。

📖 更多部署方式请参考 [部署指南](https://docs.newapi.pro/zh/docs/installation)

---

## 📚 文档

<div align="center">

### 📖 [官方文档](https://docs.newapi.pro/zh/docs) | [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Mr-Groundhog/hog-api-gateway)

</div>

**快速导航：**

| 分类 | 链接 |
|------|------|
| 🚀 部署指南 | [安装文档](https://docs.newapi.pro/zh/docs/installation) |
| ⚙️ 环境配置 | [环境变量](https://docs.newapi.pro/zh/docs/installation/config-maintenance/environment-variables) |
| 📡 接口文档 | [API 文档](https://docs.newapi.pro/zh/docs/api) |

---

## ✨ 主要特性

> 详细特性请参考 [特性说明](https://docs.newapi.pro/zh/docs/guide/wiki/basic-concepts/features-introduction)

### 🎨 核心功能

| 特性 | 说明 |
|------|------|
| 🎨 全新 UI | 现代化的用户界面设计 |
| 🌍 多语言 | 支持简体中文、英文 |
| 🔄 数据兼容 | 完全兼容原版 One API 数据库 |
| 📈 数据看板 | 可视化控制台与统计分析 |
| 🔒 权限管理 | 令牌分组、模型限制、用户管理 |
| 📢 全局播报 | Logo 旁的播报组件，以垂直轮播（每条停留 10 秒）展示平台公告，长文本在行内横向滚动；受 `broadcast_enabled` 开关控制 |

### 💰 授权用量与成本管理

- ✅ 合法授权场景下的内部充值与额度分配（易支付、Stripe）
- ✅ 组织内按次、按量或缓存命中成本核算
- ✅ 支持 OpenAI、Azure、DeepSeek、Claude、Qwen 等模型的缓存计费统计
- ✅ 面向内部管理或企业客户的灵活计费策略配置

### 🔐 授权与安全

- 😈 Discord 授权登录
- 🤖 LinuxDO 授权登录
- 📱 Telegram 授权登录
- 🔑 OIDC 统一认证
- 🔍 Key 查询使用额度（配合 [new-api-key-tool](https://github.com/Calcium-Ion/new-api-key-tool)）

### 🚀 高级功能

**API 格式支持：**
- ⚡ [OpenAI Responses](https://docs.newapi.pro/zh/docs/api/ai-model/chat/openai/create-response)
- ⚡ [OpenAI Realtime API](https://docs.newapi.pro/zh/docs/api/ai-model/realtime/create-realtime-session)（含 Azure）
- ⚡ [Claude Messages](https://docs.newapi.pro/zh/docs/api/ai-model/chat/create-message)
- ⚡ [Google Gemini](https://doc.newapi.pro/api/google-gemini-chat)
- 🔄 [Rerank 模型](https://docs.newapi.pro/zh/docs/api/ai-model/rerank/create-rerank)（Cohere、Jina）

**智能路由：**
- ⚖️ 渠道加权随机
- 🔄 失败自动重试
- 🚦 用户级别模型限流

**格式转换：**
- 🔄 **OpenAI Compatible ⇄ Claude Messages**
- 🔄 **OpenAI Compatible → Google Gemini**
- 🔄 **Google Gemini → OpenAI Compatible** - 仅支持文本，暂不支持函数调用
- 🚧 **OpenAI Compatible ⇄ OpenAI Responses** - 开发中
- 🔄 **思考转内容功能**

**Reasoning Effort 支持：**

<details>
<summary>查看详细配置</summary>

**OpenAI 系列模型：**
- `o3-mini-high` - High reasoning effort
- `o3-mini-medium` - Medium reasoning effort
- `o3-mini-low` - Low reasoning effort
- `gpt-5-high` - High reasoning effort
- `gpt-5-medium` - Medium reasoning effort
- `gpt-5-low` - Low reasoning effort

**Claude 思考模型：**
- `claude-3-7-sonnet-20250219-thinking` - 启用思考模式

**Google Gemini 系列模型：**
- `gemini-2.5-flash-thinking` - 启用思考模式
- `gemini-2.5-flash-nothinking` - 禁用思考模式
- `gemini-2.5-pro-thinking` - 启用思考模式
- `gemini-2.5-pro-thinking-128` - 启用思考模式，并设置思考预算为128tokens
- 也可以直接在 Gemini 模型名称后追加 `-low` / `-medium` / `-high` 来控制思考力度（无需再设置思考预算后缀）

</details>

---

## 🤖 模型支持

> 详情请参考 [接口文档 - 网关接口](https://docs.newapi.pro/zh/docs/api)

| 模型类型 | 说明 | 文档 |
|---------|------|------|
| 🤖 OpenAI-Compatible | OpenAI 兼容模型 | [文档](https://docs.newapi.pro/zh/docs/api/ai-model/chat/openai/createchatcompletion) |
| 🤖 OpenAI Responses | OpenAI Responses 格式 | [文档](https://docs.newapi.pro/zh/docs/api/ai-model/chat/openai/createresponse) |
| 🎨 Midjourney-Proxy | [Midjourney-Proxy(Plus)](https://github.com/novicezk/midjourney-proxy) | [文档](https://doc.newapi.pro/api/midjourney-proxy-image) |
| 🎵 Suno-API | [Suno API](https://github.com/Suno-API/Suno-API) | [文档](https://doc.newapi.pro/api/suno-music) |
| 🔄 Rerank | Cohere、Jina | [文档](https://docs.newapi.pro/zh/docs/api/ai-model/rerank/create-rerank) |
| 💬 Claude | Messages 格式 | [文档](https://docs.newapi.pro/zh/docs/api/ai-model/chat/createmessage) |
| 🌐 Gemini | Google Gemini 格式 | [文档](https://docs.newapi.pro/zh/docs/api/ai-model/chat/gemini/geminirelayv1beta) |
| 🔧 Dify | ChatFlow 模式 | - |
| 🎯 自定义上游 | 支持配置合法授权的上游接口地址 | - |

### 📡 支持的接口

<details>
<summary>查看完整接口列表</summary>

- [聊天接口 (Chat Completions)](https://docs.newapi.pro/zh/docs/api/ai-model/chat/openai/createchatcompletion)
- [响应接口 (Responses)](https://docs.newapi.pro/zh/docs/api/ai-model/chat/openai/createresponse)
- [图像接口 (Image)](https://docs.newapi.pro/zh/docs/api/ai-model/images/openai/post-v1-images-generations)
- [音频接口 (Audio)](https://docs.newapi.pro/zh/docs/api/ai-model/audio/openai/create-transcription)
- [视频接口 (Video)](https://docs.newapi.pro/zh/docs/api/ai-model/videos/sora/createvideo)
- [嵌入接口 (Embeddings)](https://docs.newapi.pro/zh/docs/api/ai-model/embeddings/createembedding)
- [重排序接口 (Rerank)](https://docs.newapi.pro/zh/docs/api/ai-model/rerank/creatererank)
- [实时对话 (Realtime)](https://docs.newapi.pro/zh/docs/api/ai-model/realtime/createrealtimesession)
- [Claude 聊天](https://docs.newapi.pro/zh/docs/api/ai-model/chat/createmessage)
- [Google Gemini 聊天](https://docs.newapi.pro/zh/docs/api/ai-model/chat/gemini/geminirelayv1beta)

</details>

---

## 🚢 部署

> [!TIP]
> **最新版 Docker 镜像：** `leileihog/hog-new-api:latest`

### 📋 部署要求

| 组件 | 要求 |
|------|------|
| **本地数据库** | SQLite（Docker 需挂载 `/data` 目录）|
| **远程数据库** | MySQL ≥ 5.7.8 或 PostgreSQL ≥ 9.6 |
| **容器引擎** | Docker / Docker Compose |
| **系统架构** | 仅支持 64 位系统（amd64 / arm64），不支持 32 位系统 |

### 🔧 部署方式

<details>
<summary><strong>方式 1：Docker Compose（推荐）</strong></summary>

```bash
# 克隆项目
git clone https://github.com/Mr-Groundhog/hog-api-gateway.git
cd hog-api-gateway

# 编辑配置
nano docker-compose.yml

# 启动服务
docker-compose up -d
```

</details>

<details>
<summary><strong>方式 2：Docker 命令</strong></summary>

**使用 SQLite：**
```bash
docker run --name new-api -d --restart always \
  -p 3000:3000 \
  -e TZ=Asia/Shanghai \
  -v ./data:/data \
  leileihog/hog-new-api:latest
```

**使用 MySQL：**
```bash
docker run --name new-api -d --restart always \
  -p 3000:3000 \
  -e SQL_DSN="root:123456@tcp(localhost:3306)/oneapi" \
  -e TZ=Asia/Shanghai \
  -v ./data:/data \
  leileihog/hog-new-api:latest
```

> **💡 路径说明：**
> - `./data:/data` - 相对路径，数据保存在当前目录的 data 文件夹
> - 也可使用绝对路径，如：`/your/custom/path:/data`

</details>

### ⚠️ 多机部署注意事项

> [!WARNING]
> - 所有节点必须使用同一个主数据库，并设置相同的 `SESSION_SECRET`；否则 Access Token、Refresh 会话和临时鉴权流程无法一致校验。
> - 连接同一个 Redis 的节点还必须设置相同的 `CRYPTO_SECRET`，否则节点生成的缓存键摘要不一致，无法正确共享缓存。

登录 Session 和单用户活跃数/签发数限制均以数据库为权威。Redis 中的 Session 仅为短期缓存，TTL 跟随 `SYNC_FREQUENCY`（默认 60 秒），且不会超过 Session 的剩余寿命。

| Redis 拓扑 | Session 状态传播 | 限流语义 |
| --- | --- | --- |
| 所有节点共享 Redis | 撤销和版本发布通常即时传播 | Redis 限流额度在节点间共享 |
| 每个节点使用独立 Redis | 最迟在有效 `SYNC_FREQUENCY` 内回源数据库收敛；版本轮换后，新 Token 在持有旧缓存的节点上可能短暂返回 401 | 每个节点独立计数，集群总额度最坏约为单节点阈值乘以节点数 |
| 不使用 Redis | 每次 Session 校验直接读取数据库 | 各节点使用独立的内存限流额度 |

缩短 `SYNC_FREQUENCY` 可减小独立 Redis 的陈旧窗口，但每个活跃 SID 在每个节点上会按该 TTL 增加一次数据库主键点查。上述保证只让 Session 鉴权在不同拓扑下保持有界陈旧；限流和其他 Redis 控制面缓存仍受拓扑影响。

Token、Origin 校验和 PAT 契约见[用户鉴权与登录会话](./docs/authentication.md)。

### 🔄 渠道重试与缓存

**重试配置：** `设置 → 运营设置 → 通用设置 → 失败重试次数`

**缓存配置：**
- `REDIS_CONN_STRING`：Redis 缓存（推荐）
- `MEMORY_CACHE_ENABLED`：内存缓存

---

## 🔗 相关项目

### 上游项目

| 项目 | 说明 |
|------|------|
| [One API](https://github.com/songquanpeng/one-api) | 原版项目基础 |
| [Midjourney-Proxy](https://github.com/novicezk/midjourney-proxy) | Midjourney 接口支持 |

### 配套工具

| 项目 | 说明 |
|------|------|
| [new-api-key-tool](https://github.com/Calcium-Ion/new-api-key-tool) | Key 额度查询工具 |
| [new-api-horizon](https://github.com/Calcium-Ion/new-api-horizon) | New API 高性能优化版 |

---

## 📜 上游项目与归属声明

本项目为 new-api 的二次开发版本。

- 上游项目：new-api
- 上游组织/作者：QuantumNous
- 上游仓库：https://github.com/QuantumNous/new-api
- One API 原始项目：https://github.com/songquanpeng/one-api

本仓库的二开功能不代表 QuantumNous 或 new-api 官方立场。部署和运营本项目时，应遵守上游服务商条款及所在地的法律、备案、内容安全、支付和数据合规要求。

## 📜 许可证

本项目继续遵循 GNU Affero General Public License v3.0。

根据上游许可证附加条款，修改版本必须保留适用的作者归属声明，并在提供用户界面时保留指向原项目的可见链接：https://github.com/QuantumNous/new-api。

本 README 不改变上游项目、QuantumNous、new-api 社区贡献者及其他依赖项目原有的版权和归属。

---

<div align="center">

### 💖 感谢使用

如果这个项目对你有帮助，欢迎给我们一个 ⭐️ Star！

**[问题反馈](https://github.com/Mr-Groundhog/hog-api-gateway/issues)** • **[最新发布](https://github.com/Mr-Groundhog/hog-api-gateway/releases)**

<sub>Built with ❤️ by QuantumNous</sub>

</div>
