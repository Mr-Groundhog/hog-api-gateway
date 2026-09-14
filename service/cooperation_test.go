package service

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func cleanupCooperationTables(t *testing.T) {
	t.Helper()
	require.NoError(t, model.DB.Where("1 = 1").Delete(&model.CooperationApplication{}).Error)
	require.NoError(t, model.DB.Where("1 = 1").Delete(&model.CooperationSite{}).Error)
	// User 带 gorm.DeletedAt，必须 Unscoped 硬删除，否则同 ID 重新插入撞唯一约束
	require.NoError(t, model.DB.Unscoped().Where("1 = 1").Delete(&model.User{}).Error)
}

func validCooperationInput() *CooperationApplicationInput {
	return &CooperationApplicationInput{
		SiteName:    "示例站点",
		SiteUrl:     "https://example.com",
		SiteType:    "blog",
		Description: "一个关于 AI 的技术博客",
		Audience:    "日活约 1000",
		Methods:     []string{"token", "invite"},
		Contact:     "admin@example.com",
		Notes:       "",
	}
}

func TestValidateCooperationApplicationInputBoundaries(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(input *CooperationApplicationInput)
		wantErr error
	}{
		{name: "valid input accepted", mutate: func(input *CooperationApplicationInput) {}},
		{name: "site name trimmed to empty rejected", mutate: func(input *CooperationApplicationInput) { input.SiteName = "   " }, wantErr: ErrCooperationSiteNameLength},
		{name: "51 Chinese site name rejected", mutate: func(input *CooperationApplicationInput) { input.SiteName = strings.Repeat("站", 51) }, wantErr: ErrCooperationSiteNameLength},
		{name: "50 Chinese site name accepted", mutate: func(input *CooperationApplicationInput) { input.SiteName = strings.Repeat("站", 50) }},
		{name: "non-http url rejected", mutate: func(input *CooperationApplicationInput) { input.SiteUrl = "ftp://example.com" }, wantErr: ErrCooperationSiteUrlInvalid},
		{name: "url without host rejected", mutate: func(input *CooperationApplicationInput) { input.SiteUrl = "https://" }, wantErr: ErrCooperationSiteUrlInvalid},
		{name: "bare domain rejected", mutate: func(input *CooperationApplicationInput) { input.SiteUrl = "example.com" }, wantErr: ErrCooperationSiteUrlInvalid},
		{name: "201-char url rejected", mutate: func(input *CooperationApplicationInput) {
			input.SiteUrl = "https://example.com/" + strings.Repeat("a", 181)
		}, wantErr: ErrCooperationSiteUrlInvalid},
		{name: "valid site banner accepted", mutate: func(input *CooperationApplicationInput) {
			input.SiteBanner = "https://cdn.example.com/banner.png"
		}},
		{name: "empty site banner accepted", mutate: func(input *CooperationApplicationInput) {
			input.SiteBanner = "  "
		}},
		{name: "bare domain site banner rejected", mutate: func(input *CooperationApplicationInput) {
			input.SiteBanner = "cdn.example.com/banner.png"
		}, wantErr: ErrCooperationSiteBannerInvalid},
		{name: "201-char site banner rejected", mutate: func(input *CooperationApplicationInput) {
			input.SiteBanner = "https://example.com/" + strings.Repeat("a", 181)
		}, wantErr: ErrCooperationSiteBannerInvalid},
		{name: "unknown site type rejected", mutate: func(input *CooperationApplicationInput) { input.SiteType = "mall" }, wantErr: ErrCooperationSiteTypeInvalid},
		{name: "empty description rejected", mutate: func(input *CooperationApplicationInput) { input.Description = " \r\n " }, wantErr: ErrCooperationDescriptionLength},
		{name: "501 Chinese description rejected", mutate: func(input *CooperationApplicationInput) { input.Description = strings.Repeat("述", 501) }, wantErr: ErrCooperationDescriptionLength},
		{name: "empty audience accepted", mutate: func(input *CooperationApplicationInput) { input.Audience = "  " }},
		{name: "101 Chinese audience rejected", mutate: func(input *CooperationApplicationInput) { input.Audience = strings.Repeat("众", 101) }, wantErr: ErrCooperationAudienceLength},
		{name: "empty methods rejected", mutate: func(input *CooperationApplicationInput) { input.Methods = nil }, wantErr: ErrCooperationMethodInvalid},
		{name: "unknown method rejected", mutate: func(input *CooperationApplicationInput) { input.Methods = []string{"token", "mining"} }, wantErr: ErrCooperationMethodDisabled},
		{name: "blank method entry rejected", mutate: func(input *CooperationApplicationInput) { input.Methods = []string{"token", "  "} }, wantErr: ErrCooperationMethodInvalid},
		{name: "empty contact rejected", mutate: func(input *CooperationApplicationInput) { input.Contact = " " }, wantErr: ErrCooperationContactLength},
		{name: "101 Chinese contact rejected", mutate: func(input *CooperationApplicationInput) { input.Contact = strings.Repeat("联", 101) }, wantErr: ErrCooperationContactLength},
		{name: "501 Chinese notes rejected", mutate: func(input *CooperationApplicationInput) { input.Notes = strings.Repeat("注", 501) }, wantErr: ErrCooperationNotesLength},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := validCooperationInput()
			tt.mutate(input)
			_, err := ValidateCooperationApplicationInput(input)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
		})
	}
}

func TestValidateCooperationApplicationInputNormalizes(t *testing.T) {
	input := validCooperationInput()
	input.SiteName = "  示例站点  "
	input.Description = "第一行\r\n第二行"
	input.Notes = "  备注\r\n内容  "
	app, err := ValidateCooperationApplicationInput(input)
	require.NoError(t, err)
	assert.Equal(t, "示例站点", app.SiteName)
	// 多行文本复用工单的 CRLF 归一化，字数计数与前端一致
	assert.Equal(t, "第一行\n第二行", app.Description)
	assert.Equal(t, "备注\n内容", app.Notes)
	// methods 序列化为 JSON 数组，可无损还原
	var methods []string
	require.NoError(t, common.UnmarshalJsonStr(app.Methods, &methods))
	assert.Equal(t, []string{"token", "invite"}, methods)
}

func TestValidateCooperationApplicationInputDedupesMethods(t *testing.T) {
	input := validCooperationInput()
	input.Methods = []string{"token", "invite", "token", " invite ", "invite"}
	app, err := ValidateCooperationApplicationInput(input)
	require.NoError(t, err)
	var methods []string
	require.NoError(t, common.UnmarshalJsonStr(app.Methods, &methods))
	assert.Equal(t, []string{"token", "invite"}, methods)
}

func TestCreateCooperationApplicationForUserLimits(t *testing.T) {
	cleanupCooperationTables(t)
	insertTicketServiceUser(t, 1, "alice")

	now := int64(1757000000)
	todayStart := now - (now % 86400)
	yesterday := todayStart - 1 // 昨天最后一秒
	yesterdayStart := todayStart - 86400

	// 模块关闭时提交被拒
	_, err := CreateCooperationApplicationForUser(1, "alice", validCooperationInput(), false, todayStart, now)
	assert.ErrorIs(t, err, ErrCooperationDisabled)

	// 昨日窗口：提交后立即驳回，累计 3 条达到每日上限（每次驳回后 pending 清零，
	// 保证拦截来自每日计数而非 pending 上限）
	for i := 0; i < MaxCooperationPerUserPerDay; i++ {
		app, err := CreateCooperationApplicationForUser(1, "alice", validCooperationInput(), true, yesterdayStart, yesterday-int64(i))
		require.NoError(t, err)
		_, err = model.ReviewCooperationApplication(app.Id, 99, model.CooperationStatusRejected, "reason", yesterday+int64(i))
		require.NoError(t, err)
	}
	_, err = CreateCooperationApplicationForUser(1, "alice", validCooperationInput(), true, yesterdayStart, yesterday-100)
	assert.ErrorIs(t, err, model.ErrCooperationDailyLimit)

	// 跨天（今日窗口）后计数重置，可再次提交
	todayApp, err := CreateCooperationApplicationForUser(1, "alice", validCooperationInput(), true, todayStart, now)
	require.NoError(t, err)

	// 待审核（pending）同时只允许一条
	_, err = CreateCooperationApplicationForUser(1, "alice", validCooperationInput(), true, todayStart, now+1)
	assert.ErrorIs(t, err, model.ErrCooperationPendingLimit)

	// 驳回后 pending 清零，可重新提交（今日计数 2/3）
	_, err = model.ReviewCooperationApplication(todayApp.Id, 99, model.CooperationStatusRejected, "受众不匹配", now+2)
	require.NoError(t, err)
	_, err = CreateCooperationApplicationForUser(1, "alice", validCooperationInput(), true, todayStart, now+3)
	require.NoError(t, err)
}

func TestReviewCooperationApplicationTransitions(t *testing.T) {
	cleanupCooperationTables(t)
	insertTicketServiceUser(t, 1, "alice")
	insertTicketServiceUser(t, 2, "bob")

	now := int64(1757000000)

	// 驳回必须填写原因，备注长度有上限
	_, err := ValidateCooperationReviewNote("", model.CooperationStatusRejected)
	assert.ErrorIs(t, err, ErrCooperationRejectNoteRequired)
	_, err = ValidateCooperationReviewNote(strings.Repeat("因", 501), model.CooperationStatusApproved)
	assert.ErrorIs(t, err, ErrCooperationReviewNoteLength)
	note, err := ValidateCooperationReviewNote("  站点质量不错，欢迎合作  ", model.CooperationStatusApproved)
	require.NoError(t, err)
	assert.Equal(t, "站点质量不错，欢迎合作", note)

	// pending → approved：审核人 / 时间 / 备注一并落库，且同一事务内自动生成
	// 一条默认启用的合作站点条目，简介超出条目上限时按码点截断
	longInput := validCooperationInput()
	longInput.SiteBanner = "https://cdn.example.com/banner.png"
	longInput.Description = strings.Repeat("述", 500)
	longApp, err := CreateCooperationApplicationForUser(1, "alice", longInput, true, now-3600, now)
	require.NoError(t, err)
	approved, err := model.ReviewCooperationApplication(longApp.Id, 99, model.CooperationStatusApproved, "通过", now+10)
	require.NoError(t, err)
	assert.Equal(t, model.CooperationStatusApproved, approved.Status)
	assert.Equal(t, 99, approved.ReviewerId)
	assert.Equal(t, now+10, approved.ReviewTime)
	assert.Equal(t, "通过", approved.ReviewNote)
	sites, err := model.GetEnabledCooperationSites()
	require.NoError(t, err)
	require.Len(t, sites, 1)
	assert.Equal(t, "示例站点", sites[0].Name)
	assert.Equal(t, "https://example.com", sites[0].Url)
	assert.Equal(t, "https://cdn.example.com/banner.png", sites[0].Banner)
	assert.Equal(t, "blog", sites[0].SiteType)
	assert.Equal(t, strings.Repeat("述", model.MaxCooperationSiteEntryDescriptionRunes), sites[0].Description)
	assert.True(t, sites[0].Enabled)

	// 已通过的申请不能再次审核（并发重复审核只生效一次），也不会再生成第二条站点
	_, err = model.ReviewCooperationApplication(longApp.Id, 99, model.CooperationStatusRejected, "反悔", now+11)
	assert.ErrorIs(t, err, model.ErrCooperationNotPending)
	sites, err = model.GetAllCooperationSites()
	require.NoError(t, err)
	assert.Len(t, sites, 1)

	// 非法目标状态被拒
	rejectedApp, err := CreateCooperationApplicationForUser(2, "bob", validCooperationInput(), true, now-3600, now+20)
	require.NoError(t, err)
	_, err = model.ReviewCooperationApplication(rejectedApp.Id, 99, model.CooperationStatusPending, "", now+21)
	assert.ErrorIs(t, err, model.ErrCooperationStatusInvalid)

	// pending → rejected 不生成站点条目，用户可重新提交
	rejected, err := model.ReviewCooperationApplication(rejectedApp.Id, 99, model.CooperationStatusRejected, "受众不匹配", now+22)
	require.NoError(t, err)
	assert.Equal(t, model.CooperationStatusRejected, rejected.Status)
	resubmitted, err := CreateCooperationApplicationForUser(2, "bob", validCooperationInput(), true, now-3600, now+23)
	require.NoError(t, err)

	// 同一站点地址再次审批通过时跳过自动建站，避免重复展示
	_, err = model.ReviewCooperationApplication(resubmitted.Id, 99, model.CooperationStatusApproved, "再次通过", now+24)
	require.NoError(t, err)
	sites, err = model.GetAllCooperationSites()
	require.NoError(t, err)
	assert.Len(t, sites, 1)
}

func TestCooperationAdminListAndStats(t *testing.T) {
	cleanupCooperationTables(t)
	insertTicketServiceUser(t, 1, "alice")
	insertTicketServiceUser(t, 2, "bob")

	now := int64(1757000000)
	dayStart := now - (now % 86400)

	input := validCooperationInput()
	input.SiteName = "Alice Blog"
	app1, err := CreateCooperationApplicationForUser(1, "alice", input, true, dayStart, now)
	require.NoError(t, err)
	input2 := validCooperationInput()
	input2.SiteName = "Bob Tools"
	input2.SiteType = "tool"
	_, err = CreateCooperationApplicationForUser(2, "bob", input2, true, dayStart, now+1)
	require.NoError(t, err)

	_, err = model.ReviewCooperationApplication(app1.Id, 99, model.CooperationStatusApproved, "通过", now+10)
	require.NoError(t, err)

	// 状态过滤 + 关键字匹配站点名或用户名
	apps, total, err := model.GetCooperationApplications(model.CooperationListFilter{Status: model.CooperationStatusPending}, &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "Bob Tools", apps[0].SiteName)

	apps, total, err = model.GetCooperationApplications(model.CooperationListFilter{Keyword: "alice"}, &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "alice", apps[0].Username)

	apps, total, err = model.GetCooperationApplications(model.CooperationListFilter{Keyword: "Tools"}, &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)

	// 概览统计：1 通过 + 1 待审核
	stats, err := GetCooperationStats()
	require.NoError(t, err)
	assert.Equal(t, int64(1), stats.Pending)
	assert.Equal(t, int64(1), stats.Approved)
	assert.Zero(t, stats.Rejected)
	assert.Equal(t, int64(2), stats.Total)

	// 删除后不可重复删除
	require.NoError(t, model.DeleteCooperationApplicationById(app1.Id))
	err = model.DeleteCooperationApplicationById(app1.Id)
	assert.ErrorIs(t, err, model.ErrCooperationNotFound)
	_, err = model.GetCooperationApplicationById(app1.Id)
	assert.ErrorIs(t, err, model.ErrCooperationNotFound)
}

// setCooperationMethodsOption 在测试内临时写入 CooperationMethodsAdmin 选项，
// 测试结束自动还原，避免污染其它用例（默认未配置 = 全部开放）。
func setCooperationMethodsOption(t *testing.T, value string) {
	t.Helper()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	common.OptionMapRWMutex.Lock()
	previous, hadPrevious := common.OptionMap["CooperationMethodsAdmin"]
	common.OptionMap["CooperationMethodsAdmin"] = value
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		defer common.OptionMapRWMutex.Unlock()
		if hadPrevious {
			common.OptionMap["CooperationMethodsAdmin"] = previous
		} else {
			delete(common.OptionMap, "CooperationMethodsAdmin")
		}
	})
}

func TestValidateCooperationApplicationInputMethodGate(t *testing.T) {
	// 管理员只开放 token / invite（旧格式字符串数组）
	setCooperationMethodsOption(t, `["token","invite"]`)

	input := validCooperationInput()
	input.Methods = []string{"token", "sponsor"}
	_, err := ValidateCooperationApplicationInput(input)
	assert.ErrorIs(t, err, ErrCooperationMethodDisabled)

	// 白名单内且开放的组合正常通过
	input.Methods = []string{"token", "invite"}
	app, err := ValidateCooperationApplicationInput(input)
	require.NoError(t, err)
	assert.Equal(t, `["token","invite"]`, app.Methods)

	// 未配置（空选项）回落全部开放
	setCooperationMethodsOption(t, "")
	input.Methods = []string{"sponsor"}
	_, err = ValidateCooperationApplicationInput(input)
	require.NoError(t, err)
}

func TestValidateCooperationApplicationInputCustomMethods(t *testing.T) {
	// 管理员自定义方式（对象格式）：内置 token + 自定义 custom_ab12
	setCooperationMethodsOption(t, `[{"id":"token"},{"id":"custom_ab12","label":"API 赞助"}]`)

	input := validCooperationInput()
	input.Methods = []string{"custom_ab12"}
	app, err := ValidateCooperationApplicationInput(input)
	require.NoError(t, err)
	var methods []string
	require.NoError(t, common.UnmarshalJsonStr(app.Methods, &methods))
	assert.Equal(t, []string{"custom_ab12"}, methods)

	// 未在配置中开放的自定义标识被拒
	input.Methods = []string{"custom_zz99"}
	_, err = ValidateCooperationApplicationInput(input)
	assert.ErrorIs(t, err, ErrCooperationMethodDisabled)
}
