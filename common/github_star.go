package common

// GitHub Star 奖励功能配置。全部通过后台「系统设置 → OAuth 集成 → GitHub」
// 标签页配置（存 options 表，root 可修改，多节点经 SyncOptions 热同步），
// 不从环境变量读取。低层技术参数（API 地址、超时、分页大小、同步间隔等）
// 使用 service 层的内置常量。
var (
	// GithubStarRewardEnabled 是否启用 GitHub Star 奖励（GithubStarRewardEnabled）。
	GithubStarRewardEnabled bool
	// GithubStarRewardDryRun 灰度模式：照常执行检测与审计，但不落领取记录、
	// 不修改额度（GithubStarRewardDryRun）。关闭灰度后用户仍可正常领取。
	GithubStarRewardDryRun bool
	// GithubStarOwner / GithubStarRepo 目标仓库（GithubStarOwner / GithubStarRepo）。
	GithubStarOwner string
	GithubStarRepo  string
	// GithubStarCampaign 活动标识（GithubStarCampaign），领取记录按其做唯一
	// 约束；切换为新的值即视为开启新一轮活动，可重新发放。默认 github-star，
	// 管理员清空时按默认值生效。
	GithubStarCampaign = "github-star"
	// GithubStarRewardQuota 单次奖励额度（GithubStarRewardQuota，内部额度单位，
	// 由 updateOptionMap 钳制在 [0, MaxQuota]）。默认 5000000，即 10 美元等值
	// （按默认 QuotaPerUnit = 500000 / 美元 换算）。
	GithubStarRewardQuota = 5000000
	// GithubStarAccessToken Stargazers 访问令牌（GithubStarAccessToken），
	// Fine-grained PAT（需 Starring: Read-only 用户权限与 Metadata: Read-only
	// 仓库权限，且令牌属主为目标仓库管理员/协作者）。GitHub 自 2026-07 起
	// 将 stargazers 列表接口限制为用户身份访问，GitHub App Installation
	// Token 会被拒绝，认证只能使用该 PAT。仅 root 可见，不得返回普通用户
	// 或写入普通日志。
	GithubStarAccessToken string
	// GithubStarSyncEnabled 是否启用 Stargazers 定时同步（GithubStarSyncEnabled），默认开启。
	GithubStarSyncEnabled = true
)

// GithubStarRewardConfigured 判断 Stargazers 访问令牌与目标仓库是否配置
// 完整。未配置完整时功能不可用（申请、复审、同步全部跳过），避免半配置
// 状态下产生误导性结果。
func GithubStarRewardConfigured() bool {
	return GithubStarAccessToken != "" &&
		GithubStarOwner != "" &&
		GithubStarRepo != ""
}

// GithubStarRepository 返回 "owner/repo" 形式的仓库标识。
func GithubStarRepository() string {
	return GithubStarOwner + "/" + GithubStarRepo
}

// GithubStarRepositoryURL 返回仓库页面地址。
func GithubStarRepositoryURL() string {
	return "https://github.com/" + GithubStarRepository()
}
