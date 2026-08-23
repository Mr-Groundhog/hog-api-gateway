<div align="center">

![new-api](/web/public/logo.png)

# New API

🍥 **Next-Generation LLM Gateway and AI Asset Management System**

<p align="center">
  <a href="./README.zh_CN.md">简体中文</a> |
  <strong>English</strong>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-key-features">Key Features</a> •
  <a href="#-recent-updates-unreleased">Recent Updates</a> •
  <a href="#-deployment">Deployment</a> •
  <a href="#-documentation">Documentation</a>
</p>

</div>

> 本项目基于 [new-api](https://github.com/QuantumNous/new-api) 二次开发，遵循 AGPLv3 协议，感谢原作者 [QuantumNous](https://github.com/QuantumNous) 及社区贡献者。

## 📝 Project Description

> [!IMPORTANT]
> - This project is intended solely for lawful and authorized AI API gateway, organization-level authentication, multi-model management, usage analytics, cost accounting, and private deployment scenarios.
> - Users must lawfully obtain upstream API keys, accounts, model services, and interface permissions, and must comply with upstream terms of service and applicable laws and regulations.
> - Users should ensure their use complies with upstream terms of service and applicable laws and regulations.
> - When providing generative AI services to the public, users should comply with applicable regulatory requirements and fulfill all filing, licensing, content safety, real-name verification, log retention, tax, and upstream authorization obligations required by their jurisdiction.

---

## 🆕 Recent Updates (Unreleased)

> All items below are features **added or optimized by this fork on top of upstream** — no upstream capability was removed or replaced.

### ✨ New features

**🛡️ Risk control & security**

- **🚨 Probe Guard** — Detects and blocks "cross-model batch probing" (users rapidly testing many models to check whether a key works). Counts the **number of distinct models** requested per user in a sliding window; exceeding the threshold is treated as batch probing and triggers a configurable action: warning (HTTP 403 with a dedicated error code), automatic ban (invalidating all sessions and tokens), or observation mode (DryRun, log only). Window length, model threshold, and allowed trigger count are all configurable; admins, selected groups, and whitelisted user IDs can be exempted; deployments without Redis fall back to an in-memory implementation, and a failing risk-control component never blocks normal relaying.
- **🧭 Risk Control Center** — The former "Sensitive-word Hits" admin page is upgraded to a dual-tab "Risk Control Center". The sensitive-word tab keeps all existing behavior; the new "Probe List" tab aggregates probe-guard triggers per user (trigger count, recently probed models, latest trigger IP and time, automatic high/medium/low risk badges). Each user row expands into trigger details (IP, action, distinct-model count and list, User-Agent) with reset-count, ban, delete, and one-click clear-observation actions.
- **🎫 Registration codes** — Admins can generate one-time registration codes and enable "registration code required" in system settings to gate new sign-ups. Fully independent from redemption codes: both password and OAuth registration flows enforce the check (with automatic rollback of the just-created user if consumption fails; WeChat cannot carry a code, so new-user creation via WeChat is disabled while the check is on — existing accounts are unaffected). The registration form debounces live pre-validation (distinguishing invalid / used / expired); the admin side supports search, editing, enable/disable, soft delete, bulk copy, TXT export, bulk disable, and one-click cleanup of invalid codes.
- **🚫 Conditional user ban** — A new **Conditional Ban** button next to "Add User" on the user management page batch-bans users matching a condition, by **last login time** or **last API call time**, with presets (3/7/15/30 days ago) or a custom date-time precise to the minute. The effect matches an individual ban: user disabled, `auth_version` bumped to invalidate old sessions and tokens, token cache cleared.
- **📝 Manual ban reasons** — Manually disabling a user now opens a ban-reason dialog with four built-in reasons (batch probing, invite-farming alt accounts, repeated sensitive-word violations, jailbreak/prohibited content) plus a custom reason (up to 255 characters). Banned users see a localized reason message on login; re-enabling a user clears the reason automatically.
- **🌐 "Login IP" column on the user list** — A new column after "Last Login" shows the **most recent successful login IP** for each user, written on every successful login across password / 2FA / Passkey / OAuth / WeChat / Telegram. Full multi-IP login history remains in the existing login audit log.
- **📍 Registration source tracking** — Records each user's registration channel (password sign-up, admin-created, WeChat, GitHub / Discord / OIDC / LinuxDO / Telegram / custom OAuth), shown as a new "Registration Source" column in the user table; existing users are back-filled based on their third-party account bindings.
- **📊 User ranking (IP statistics)** — A new "User Ranking" page in the admin sidebar aggregates per-user distinct historical IPs, distinct IPs in the last 10 minutes, and API call counts from the API usage logs, with "today / last 3 days" period selection, sorted by distinct IP count descending, returning the Top 50 with a 30-second auto-refresh.

**🔍 Sensitive-word management enhancements**

- **🖍️ Hit highlighting & navigation** — The violation detail dialog splits request content into hit/plain segments and highlights them; hit words are listed as red badges, with a "locate hit word" action that cycles through hits with smooth scrolling and a live "hit x/y of n" counter. Request content is no longer previewed via hover tooltips and is revealed only inside the dialog, avoiding leaks.
- **👥 Per-user aggregated view** — The sensitive-word violation page is reworked into a per-user aggregated table (violation count, trigger count, highlighted flag, latest violation time); each user row expands into their violation details (paginated, full request content viewable), keeping reset-count and ban actions inside the expanded area.
- **🗑️ Bulk violation deletion** — Batch-cleans violation records by selected IDs, by days (1–36500), or by a custom cutoff time, returning the actual number of deleted rows.
- **🔎 Filtering & management enhancements** — Filter by user (username or user ID), date range, and "highlighted only"; one-click copy of full request content; per-user reset of cumulative trigger counts (also clearing historical highlight marks).
- **🚪 Filter group exemptions** — Security settings gain an excluded-groups multi-select; requests from these user groups skip sensitive-word filtering, while the global filter switch still applies.

**🎁 Operations & marketing**

- **🪂 Welfare Airdrop** — Time-limited quota airdrops: admins create airdrop campaigns (per-claim quota, total stock, one claim per user, start/end window, user group); users see active and upcoming campaigns in a carousel on the "Welfare Airdrop" page, claim with one click, and review their recent claims (redeemable code copyable). Integrated with redemption-code batches — creating/deleting/toggling airdrop codes automatically syncs campaign stock, avoiding "ghost stock". The whole claim runs in a single transaction (validation, atomic stock decrement, code occupation, crediting, top-up log) and is race-safe even on SQLite.
- **🎰 Lucky-grid lottery** — A new "Mystery Lucky Grid" entry in the header navigation (toggleable in system settings): weighted random draws, optional per-prize daily quota limits (0 = unlimited), one draw per user per business day; real-time winning records and remaining draws; the admin "Lottery Settings" section manages prizes (add/edit/delete/toggle, weight, daily quota).
- **📄 Redemption code bulk export to TXT** — After multi-selecting codes on the redemption-code page, a new **Export** button in the bulk-action bar writes the selected `key`s line-by-line into a `.txt` file (filename includes the selected count) for offline distribution or backup.
- **⏸️ Redemption code bulk disable** — A new "bulk disable selected codes" action in the bulk bar, applying only to enabled codes and reporting success/failure counts.
- **🔁 One redemption per user per day (toggleable)** — General settings gain a `Limit redemption to once per user per day` switch. When on, a logged-in user may redeem only **one** quota code per day (any batch); further attempts return `redeem.daily_limit_reached`. Default off; applies on save with no restart needed.

**🧩 UI & experience**

- **🐙 GitHub repository link** — A GitHub icon button with tooltip is added to the post-login top bar and the public page header.
- **🧪 Channel-test input panel** — The channel test dialog gains an expandable "test input" panel showing the actual prompts, embedding texts, image prompts, and rerank queries/documents sent per endpoint type, so admins can verify what test requests contain.

### 🔧 Optimizations

- **🎯 OAuth button redesign** — Third-party login buttons on the login/register pages switch from full-width vertical text buttons to horizontally arranged 44px icon squares with provider tooltips; providers without icons show the initial of their name, and `aria-label` / `title` accessibility attributes were added.
- **🧾 Login form layout** — Alternative login methods (Passkey / WeChat / OAuth) are now always shown directly below the password form, no longer repositioned based on the enabled login-method combination.
- **🔊 Broadcast management** — New broadcasts are inserted at the top of the list in system settings (instead of the tail); action column is right-aligned.
- **📐 Airdrop campaign management layout** — Replaced the fixed-width card layout with a container that fills the tab area and scrolls vertically.
- **🔕 Session-expired toast deduplication** — The "Session expired!" toast on 401 now fires only once per session, preventing duplicate popups from concurrent failed requests; the flag resets after a successful token refresh.
- **🔍 Sensitive-word whole-word matching (English)** — Pure-ASCII words (e.g. `hi`, `hello`) now match only as whole words, avoiding false hits on `this`, `which`, `machine`, `pinterest`, etc.; non-ASCII (e.g. Chinese) words keep substring matching.
- **📢 Global Broadcast display rework** — Hidden when `broadcast_enabled` is `false` (previously always shown); a single broadcast is displayed statically instead of being endlessly duplicated; multiple broadcasts cycle as a **vertical carousel** (10s per item, slide-up transition) with adaptive inline horizontal scrolling for long text; the status dot is strictly vertically centered with the text.
- **🧪 Channel-test default inputs** — The default test prompt for Chat (OpenAI) / Responses / Claude / Gemini changed from `hi` to `In the most concise way, tell me what month it is now.`, and the embeddings test input changed from `hello world` to `What day is it today?`, so backend channel tests are no longer blocked by a `hi`/`hello` sensitive-word rule while real probing requests are still caught.

### 🔄 Other changes

- **🌐 Interface languages simplified** — The frontend UI languages were trimmed to **Simplified Chinese** and **English**, removing Traditional Chinese, French, Japanese, Russian, and Vietnamese.

---

## 🚀 Quick Start

### Using Docker Compose (Recommended)

```bash
# Clone the project
git clone https://github.com/Mr-Groundhog/hog-api-gateway.git
cd hog-api-gateway

# Edit docker-compose.yml configuration
nano docker-compose.yml

# Start the service
docker-compose up -d
```

<details>
<summary><strong>Using Docker Commands</strong></summary>

```bash
# Pull the latest image
docker pull leileihog/hog-new-api:latest

# Using SQLite (default)
docker run --name new-api -d --restart always \
  -p 3000:3000 \
  -e TZ=Asia/Shanghai \
  -v ./data:/data \
  leileihog/hog-new-api:latest

# Using MySQL
docker run --name new-api -d --restart always \
  -p 3000:3000 \
  -e SQL_DSN="root:123456@tcp(localhost:3306)/oneapi" \
  -e TZ=Asia/Shanghai \
  -v ./data:/data \
  leileihog/hog-new-api:latest
```

> **💡 Tip:** `-v ./data:/data` will save data in the `data` folder of the current directory, you can also change it to an absolute path like `-v /your/custom/path:/data`

</details>

---

🎉 After deployment is complete, visit `http://localhost:3000` to start using!

> [!WARNING]
> When operating this project as a public generative AI service or API resale service, users should first complete all required filing, licensing, content safety, real-name verification, log retention, tax, payment, and upstream authorization obligations.

📖 For more deployment methods, please refer to [Deployment Guide](https://docs.newapi.pro/en/docs/installation)

---

## 📚 Documentation

<div align="center">

### 📖 [Official Documentation](https://docs.newapi.pro/en/docs) | [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Mr-Groundhog/hog-api-gateway)

</div>

**Quick Navigation:**

| Category | Link |
|------|------|
| 🚀 Deployment Guide | [Installation Documentation](https://docs.newapi.pro/en/docs/installation) |
| ⚙️ Environment Configuration | [Environment Variables](https://docs.newapi.pro/en/docs/installation/config-maintenance/environment-variables) |
| 📡 API Documentation | [API Documentation](https://docs.newapi.pro/en/docs/api) |

---

## ✨ Key Features

> For detailed features, please refer to [Features Introduction](https://docs.newapi.pro/en/docs/guide/wiki/basic-concepts/features-introduction)

### 🎨 Core Functions

| Feature | Description |
|------|------|
| 🎨 New UI | Modern user interface design |
| 🌍 Multi-language | Supports Simplified Chinese and English |
| 🔄 Data Compatibility | Fully compatible with the original One API database |
| 📈 Data Dashboard | Visual console and statistical analysis |
| 🔒 Permission Management | Token grouping, model restrictions, user management |
| 📢 Global Broadcast | A broadcast widget next to the logo; shows platform announcements with a vertical carousel (10s per item) and inline text scrolling for long messages; respects the `broadcast_enabled` switch |

### 💰 Authorized Usage Accounting and Billing

- ✅ Internal top-up and quota allocation for lawful authorized scenarios (EPay, Stripe)
- ✅ Organization-level per-request, usage-based, and cache-hit cost accounting
- ✅ Cache billing statistics for OpenAI, Azure, DeepSeek, Claude, Qwen, and supported models
- ✅ Flexible billing policies for internal management or authorized enterprise customers

### 🔐 Authorization and Security

- 😈 Discord authorization login
- 🤖 LinuxDO authorization login
- 📱 Telegram authorization login
- 🔑 OIDC unified authentication
- 🔍 Key quota query usage (with [new-api-key-tool](https://github.com/Calcium-Ion/new-api-key-tool))

### 🚀 Advanced Features

**API Format Support:**
- ⚡ [OpenAI Responses](https://docs.newapi.pro/en/docs/api/ai-model/chat/openai/create-response)
- ⚡ [OpenAI Realtime API](https://docs.newapi.pro/en/docs/api/ai-model/realtime/create-realtime-session) (including Azure)
- ⚡ [Claude Messages](https://docs.newapi.pro/en/docs/api/ai-model/chat/create-message)
- ⚡ [Google Gemini](https://doc.newapi.pro/en/api/google-gemini-chat)
- 🔄 [Rerank Models](https://docs.newapi.pro/en/docs/api/ai-model/rerank/create-rerank) (Cohere, Jina)

**Intelligent Routing:**
- ⚖️ Channel weighted random
- 🔄 Automatic retry on failure
- 🚦 User-level model rate limiting

**Format Conversion:**
- 🔄 **OpenAI Compatible ⇄ Claude Messages**
- 🔄 **OpenAI Compatible → Google Gemini**
- 🔄 **Google Gemini → OpenAI Compatible** - Text only, function calling not supported yet
- 🚧 **OpenAI Compatible ⇄ OpenAI Responses** - In development
- 🔄 **Thinking-to-content functionality**

**Reasoning Effort Support:**

<details>
<summary>View detailed configuration</summary>

**OpenAI series models:**
- `o3-mini-high` - High reasoning effort
- `o3-mini-medium` - Medium reasoning effort
- `o3-mini-low` - Low reasoning effort
- `gpt-5-high` - High reasoning effort
- `gpt-5-medium` - Medium reasoning effort
- `gpt-5-low` - Low reasoning effort

**Claude thinking models:**
- `claude-3-7-sonnet-20250219-thinking` - Enable thinking mode

**Google Gemini series models:**
- `gemini-2.5-flash-thinking` - Enable thinking mode
- `gemini-2.5-flash-nothinking` - Disable thinking mode
- `gemini-2.5-pro-thinking` - Enable thinking mode
- `gemini-2.5-pro-thinking-128` - Enable thinking mode with thinking budget of 128 tokens
- You can also append `-low`, `-medium`, or `-high` to any Gemini model name to request the corresponding reasoning effort (no extra thinking-budget suffix needed).

</details>

---

## 🤖 Model Support

> For details, please refer to [API Documentation - Gateway Interface](https://docs.newapi.pro/en/docs/api)

| Model Type | Description | Documentation |
|---------|------|------|
| 🤖 OpenAI-Compatible | OpenAI compatible models | [Documentation](https://docs.newapi.pro/en/docs/api/ai-model/chat/openai/createchatcompletion) |
| 🤖 OpenAI Responses | OpenAI Responses format | [Documentation](https://docs.newapi.pro/en/docs/api/ai-model/chat/openai/createresponse) |
| 🎨 Midjourney-Proxy | [Midjourney-Proxy(Plus)](https://github.com/novicezk/midjourney-proxy) | [Documentation](https://doc.newapi.pro/api/midjourney-proxy-image) |
| 🎵 Suno-API | [Suno API](https://github.com/Suno-API/Suno-API) | [Documentation](https://doc.newapi.pro/api/suno-music) |
| 🔄 Rerank | Cohere, Jina | [Documentation](https://docs.newapi.pro/en/docs/api/ai-model/rerank/creatererank) |
| 💬 Claude | Messages format | [Documentation](https://docs.newapi.pro/en/docs/api/ai-model/chat/createmessage) |
| 🌐 Gemini | Google Gemini format | [Documentation](https://docs.newapi.pro/en/docs/api/ai-model/chat/gemini/geminirelayv1beta) |
| 🔧 Dify | ChatFlow mode | - |
| 🎯 Custom upstream | Supports configuring legally authorized upstream endpoints | - |

### 📡 Supported Interfaces

<details>
<summary>View complete interface list</summary>

- [Chat Interface (Chat Completions)](https://docs.newapi.pro/en/docs/api/ai-model/chat/openai/createchatcompletion)
- [Response Interface (Responses)](https://docs.newapi.pro/en/docs/api/ai-model/chat/openai/createresponse)
- [Image Interface (Image)](https://docs.newapi.pro/en/docs/api/ai-model/images/openai/post-v1-images-generations)
- [Audio Interface (Audio)](https://docs.newapi.pro/en/docs/api/ai-model/audio/openai/create-transcription)
- [Video Interface (Video)](https://docs.newapi.pro/en/docs/api/ai-model/audio/openai/createspeech)
- [Embedding Interface (Embeddings)](https://docs.newapi.pro/en/docs/api/ai-model/embeddings/createembedding)
- [Rerank Interface (Rerank)](https://docs.newapi.pro/en/docs/api/ai-model/rerank/creatererank)
- [Realtime Conversation (Realtime)](https://docs.newapi.pro/en/docs/api/ai-model/realtime/createrealtimesession)
- [Claude Chat](https://docs.newapi.pro/en/docs/api/ai-model/chat/createmessage)
- [Google Gemini Chat](https://docs.newapi.pro/en/docs/api/ai-model/chat/gemini/geminirelayv1beta)

</details>

---

## 🚢 Deployment

> [!TIP]
> **Latest Docker image:** `leileihog/hog-new-api:latest`

### 📋 Deployment Requirements

| Component | Requirement |
|------|------|
| **Local database** | SQLite (Docker must mount `/data` directory)|
| **Remote database** | MySQL ≥ 5.7.8 or PostgreSQL ≥ 9.6 |
| **Container engine** | Docker / Docker Compose |
| **System architecture** | 64-bit only (amd64 / arm64); 32-bit systems are not supported |

### 🔧 Deployment Methods

<details>
<summary><strong>Method 1: Docker Compose (Recommended)</strong></summary>

```bash
# Clone the project
git clone https://github.com/Mr-Groundhog/hog-api-gateway.git
cd hog-api-gateway

# Edit configuration
nano docker-compose.yml

# Start service
docker-compose up -d
```

</details>

<details>
<summary><strong>Method 2: Docker Commands</strong></summary>

**Using SQLite:**
```bash
docker run --name new-api -d --restart always \
  -p 3000:3000 \
  -e TZ=Asia/Shanghai \
  -v ./data:/data \
  leileihog/hog-new-api:latest
```

**Using MySQL:**
```bash
docker run --name new-api -d --restart always \
  -p 3000:3000 \
  -e SQL_DSN="root:123456@tcp(localhost:3306)/oneapi" \
  -e TZ=Asia/Shanghai \
  -v ./data:/data \
  leileihog/hog-new-api:latest
```

> **💡 Path explanation:**
> - `./data:/data` - Relative path, data saved in the data folder of the current directory
> - You can also use absolute path, e.g.: `/your/custom/path:/data`

</details>

### ⚠️ Multi-machine Deployment Considerations

> [!WARNING]
> - All nodes must use the same primary database and the same `SESSION_SECRET`; otherwise Access Tokens, refresh sessions, and temporary authentication flows cannot be verified consistently.
> - Nodes connected to the same Redis must also use the same `CRYPTO_SECRET`, or their cache-key digests will differ and shared entries cannot be reused consistently.

The database is authoritative for login Sessions and for the per-user active/issuance limits. Redis Session entries are short-lived caches whose TTL follows `SYNC_FREQUENCY` (60 seconds by default) and never exceeds the Session's remaining lifetime.

| Redis topology | Session propagation | Rate limiting |
| --- | --- | --- |
| Shared Redis | Revocations and version publications normally propagate immediately | Redis limits are shared across nodes |
| Independent Redis per node | Nodes converge from the database within the effective `SYNC_FREQUENCY`; a newly rotated token may receive a temporary 401 on a node with stale cache | Each node has its own allowance, so aggregate capacity can reach roughly the configured limit multiplied by the node count |
| No Redis | Every Session validation reads the database | In-memory limits are independent per node |

A shorter `SYNC_FREQUENCY` reduces the independent-Redis staleness window but causes one additional primary-key Session lookup per active SID, per node, per TTL. These guarantees make Session authentication bounded-stale across the supported topologies; rate limits and other Redis-backed control-plane caches remain topology-dependent.

See [User authentication and login sessions](./docs/authentication.md) for the token, Origin-check and PAT contracts.

### 🔄 Channel Retry and Cache

**Retry configuration:** `Settings → Operation Settings → General Settings → Failure Retry Count`

**Cache configuration:**
- `REDIS_CONN_STRING`: Redis cache (recommended)
- `MEMORY_CACHE_ENABLED`: Memory cache

---

## 🔗 Related Projects

### Upstream Projects

| Project | Description |
|------|------|
| [One API](https://github.com/songquanpeng/one-api) | Original project base |
| [Midjourney-Proxy](https://github.com/novicezk/midjourney-proxy) | Midjourney interface support |

### Supporting Tools

| Project | Description |
|------|------|
| [new-api-key-tool](https://github.com/Calcium-Ion/new-api-key-tool) | Key quota query tool |
| [new-api-horizon](https://github.com/Calcium-Ion/new-api-horizon) | New API high-performance optimized version |

---

## 📜 License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPLv3)](./LICENSE).

Additional terms under AGPLv3 Section 7 apply. Modified versions must preserve
the author attribution notice `Frontend design and development by New API
contributors.` in the appropriate legal notices and in any prominent about,
legal, footer, or attribution location presented by the user interface.

Modified versions that present a user interface must also preserve a visible
link to the original project: <https://github.com/QuantumNous/new-api>.

This is an open-source project developed based on [One API](https://github.com/songquanpeng/one-api) (MIT License).

---

<div align="center">

### 💖 Thank You for Using

If this project is helpful to you, welcome to give us a ⭐️ Star！

**[Issue Feedback](https://github.com/Mr-Groundhog/hog-api-gateway/issues)** • **[Latest Release](https://github.com/Mr-Groundhog/hog-api-gateway/releases)**

<sub>Built with ❤️ by QuantumNous</sub>

</div>
