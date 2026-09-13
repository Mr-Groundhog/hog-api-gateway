package service

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

var (
	githubStarSyncOnce    sync.Once
	githubStarSyncRunning atomic.Bool
)

// githubStarSyncInterval 是 Stargazers 同步间隔（内置常量）。间隔内新 Star
// 的用户领取时会走实时检测兜底，不会因缓存未更新而无法领取。
const githubStarSyncInterval = 8 * time.Hour

// StartGithubStarStargazersSyncTask 启动 Stargazers 定时同步（方案第 10 节）：
// 周期性全量拉取目标仓库 Stargazers 写入本地缓存表，让用户申请优先命中缓存、
// 减少 GitHub API 调用。只在主节点运行；是否启用与奖励活动状态在每次轮询时
// 读取后台配置（GithubStarSyncEnabled / 奖励开关），后台改配置无需重启。
// 同步只增改缓存记录，不删除（用户取消 Star 后是否撤销奖励由管理员复审决定）。
func StartGithubStarStargazersSyncTask() {
	githubStarSyncOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			logger.LogInfo(context.Background(), fmt.Sprintf("github star stargazers sync task started: interval=%s", githubStarSyncInterval))
			ticker := time.NewTicker(githubStarSyncInterval)
			defer ticker.Stop()

			runGithubStarStargazersSyncOnce()
			for range ticker.C {
				runGithubStarStargazersSyncOnce()
			}
		})
	})
}

func runGithubStarStargazersSyncOnce() {
	if !githubStarSyncRunning.CompareAndSwap(false, true) {
		return
	}
	defer githubStarSyncRunning.Store(false)

	if !common.GithubStarSyncEnabled || !GithubStarRewardActive() {
		return
	}
	ctx := context.Background()
	accessToken := common.GithubStarAccessToken

	total := 0
	pages := 0
	for page := 1; page <= maxGithubStarPages; page++ {
		items, statusCode, err := fetchGithubStargazersPage(ctx, accessToken, page)
		if err != nil {
			model.RecordGithubStarAuditLog(&model.GithubStarAuditLog{
				CampaignKey:      common.GithubStarCampaign,
				Action:           model.GithubStarAuditActionSync,
				Result:           model.GithubStarAuditResultSyncFailed,
				GithubStatusCode: statusCode,
				GithubPage:       page,
				Detail:           err.Error(),
			})
			logger.LogWarn(ctx, fmt.Sprintf("github star stargazers sync failed at page %d: %v", page, err))
			return
		}
		now := time.Now().Unix()
		stargazers := make([]*model.GithubStargazer, 0, len(items))
		for _, item := range items {
			stargazers = append(stargazers, &model.GithubStargazer{
				CampaignKey: common.GithubStarCampaign,
				GithubId:    item.GithubId,
				GithubLogin: item.GithubLogin,
				StarredAt:   item.StarredAt,
				FirstSeenAt: now,
				LastSeenAt:  now,
			})
		}
		if err := model.UpsertGithubStargazers(stargazers); err != nil {
			model.RecordGithubStarAuditLog(&model.GithubStarAuditLog{
				CampaignKey: common.GithubStarCampaign,
				Action:      model.GithubStarAuditActionSync,
				Result:      model.GithubStarAuditResultSyncFailed,
				GithubPage:  page,
				Detail:      "upsert stargazers: " + err.Error(),
			})
			logger.LogWarn(ctx, fmt.Sprintf("github star stargazers sync upsert failed at page %d: %v", page, err))
			return
		}
		total += len(items)
		pages = page
		if len(items) < githubStarPageSize {
			break
		}
	}
	model.RecordGithubStarAuditLog(&model.GithubStarAuditLog{
		CampaignKey: common.GithubStarCampaign,
		Action:      model.GithubStarAuditActionSync,
		Result:      model.GithubStarAuditResultSyncSuccess,
		GithubPage:  pages,
		Detail:      fmt.Sprintf("synced %d stargazers in %d pages", total, pages),
	})
}
