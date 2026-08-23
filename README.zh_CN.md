<div align="center">

![new-api](/web/public/logo.png)

# New API

🍥 **新一代大模型网关与AI资产管理系统**

<p align="center">
  简体中文 |
  <a href="./README.md">English</a>
</p>

<p align="center">
  <a href="#-快速开始">快速开始</a> •
  <a href="#-主要特性">主要特性</a> •
  <a href="#-最近更新未发布">最近更新</a> •
  <a href="#-部署">部署</a> •
  <a href="#-文档">文档</a>
</p>

</div>

> 本项目基于 [new-api](https://github.com/QuantumNous/new-api) 二次开发，遵循 AGPLv3 协议，感谢原作者及社区贡献者。

## 📝 项目说明

> [!IMPORTANT]
> - 本项目仅面向合法授权的 AI API 网关、组织内部鉴权、多模型管理、用量统计、成本核算和私有化部署场景。
> - 使用者必须合法取得上游 API Key、账号、模型服务或接口权限，并遵守上游服务条款及适用法律法规。
> - 使用者应确保其使用方式符合上游服务条款及适用法律法规。
> - 面向公众提供生成式人工智能服务时，使用者应遵守[《生成式人工智能服务管理暂行办法》](http://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm)等监管要求，自行完成所在司法辖区要求的备案、许可、内容安全、实名、日志留存、税务和上游授权等合规义务。

---

## 🆕 最近更新（未发布）

> 以下所有条目均为**在既有功能之上的扩展**——没有移除或替换任何已有能力，每一条都为已经上线的功能新增了行为。

### ✨ 新增功能（均扩展既有模块）

- **📄 兑换码批量导出 TXT** —— *扩展已有的兑换码管理页*（`/redemption-codes`）。多选兑换码后，底部批量操作栏新增「导出」按钮，将选中兑换码的 `key` 逐行导出为 `.txt` 文件（文件名含选中数量），便于离线分发或备份。
- **🔁 每用户每日限兑换一次额度码（可开关）** —— *扩展已有的额度码兑换流程*。系统设置 → 通用设置新增「每用户每天仅限兑换一次额度码」开关。开启后，同一已登录用户每天只能成功兑换 1 张额度码（不论批次），再次兑换返回 `redeem.daily_limit_reached`。由新增的 `user_redemption_logs` 表与 `GeneralSetting.RedemptionPerUserDailyLimit` 开关支撑（默认关闭，保存即生效，无需重启）。
- **🚫 条件封禁用户** —— *扩展已有的用户管理页*（`/users`）。「添加用户」按钮旁新增「条件封禁」按钮，弹窗可批量封禁满足条件的用户（效果等同单独封禁：置为禁用、提升 `auth_version` 使旧会话与令牌失效、清理令牌缓存）。支持按「上次登录时间」或「最近调用时间」筛选，可选手动日期或预设（3/7/15/30 天前）。新增接口 `POST /api/user/ban_by_condition`。
- **🌐 用户列表新增「登录 IP」列** —— *扩展已有的用户表格*。在「上次登录」列后新增「登录 IP」列，展示该用户**最近一次成功登录系统所使用的 IP**，在密码 / 2FA / Passkey / OAuth / 微信 / Telegram 全部登录方式中登录成功时写入。（完整的多次登录 IP 历史仍保留在既有的登录审计日志中。）

### 🔧 优化功能（改进既有行为）

- **🔍 敏感词整词匹配（英文）** —— *改进已有的敏感词过滤*。对纯 ASCII 字母/数字/下划线组成的敏感词（如 `hi`、`hello`）改为整词匹配，避免误伤 `this`、`which`、`machine`、`pinterest` 等普通英文单词；中文等非纯 ASCII 敏感词仍按子串匹配。
- **📢 全局播报展示重构** —— *改进 Logo 旁的既有播报组件*。现在：`broadcast_enabled` 为 `false` 时不再渲染（此前始终显示）；仅一条播报时静态显示，不再无限复制重复；多条播报改为**垂直轮播**（每条停留 10 秒、向上滑入切换），长文本在行内横向滚动；类型状态圆点与文字已严格垂直居中对齐。
- **🧪 通道测试默认招呼语调整** —— *调整既有的通道测试默认值*。Chat / Responses / Responses-Compaction / Claude / Gemini 五种格式的默认测试内容由 `hi` 改为 `In the most concise way, tell me what month it is now.`，使后台通道测试不再被自身发送的 `hi` 误拦，同时保留对真实 `hi`/`hello` 测活请求的拦截能力。
- **🛡️ 九宫格抽奖额度安全与展示清理** —— *加固既有的抽奖发奖流程*。奖项额度现在受可表示额度上限约束，事务内原子发放同时要求用户记录存在且额度有足够余量；发放失败会回滚整次抽奖，并返回 `LOTTERY_QUOTA_OVERFLOW`，避免产生中奖记录与实际额度不一致。用户端中奖结果统一使用额度格式化展示，同时移除重复的格子图标和后台图标/色调编辑项。

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

### 📖 [官方文档](https://docs.newapi.pro/zh/docs) | [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/QuantumNous/new-api)

</div>

**快速导航：**

| 分类 | 链接 |
|------|------|
| 🚀 部署指南 | [安装文档](https://docs.newapi.pro/zh/docs/installation) |
| ⚙️ 环境配置 | [环境变量](https://docs.newapi.pro/zh/docs/installation/config-maintenance/environment-variables) |
| 📡 接口文档 | [API 文档](https://docs.newapi.pro/zh/docs/api) |
| ❓ 常见问题 | [FAQ](https://docs.newapi.pro/zh/docs/support/faq) |
| 💬 社区交流 | [交流渠道](https://docs.newapi.pro/zh/docs/support/community-interaction) |

---

## ✨ 主要特性

> 详细特性请参考 [特性说明](https://docs.newapi.pro/zh/docs/guide/wiki/basic-concepts/features-introduction)

### 🎨 核心功能

| 特性 | 说明 |
|------|------|
| 🎨 全新 UI | 现代化的用户界面设计 |
| 🌍 多语言 | 支持中文、英文、法语、日语 |
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
- [视频接口 (Video)](https://docs.newapi.pro/zh/docs/api/ai-model/audio/openai/createspeech)
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

## 📜 许可证

本项目采用 [GNU Affero 通用公共许可证 v3.0 (AGPLv3)](./LICENSE) 授权。

本项目为开源项目，在 [One API](https://github.com/songquanpeng/one-api)（MIT 许可证）的基础上进行二次开发。

---

<div align="center">

### 💖 感谢使用 New API

如果这个项目对你有帮助，欢迎给我们一个 ⭐️ Star！

**[官方文档](https://docs.newapi.pro/zh/docs)** • **[问题反馈](https://github.com/Calcium-Ion/new-api/issues)** • **[最新发布](https://github.com/Calcium-Ion/new-api/releases)**

<sub>Built with ❤️ by QuantumNous</sub>

</div>
