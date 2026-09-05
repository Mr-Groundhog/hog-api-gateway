package service

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func cleanupTicketServiceTables(t *testing.T) {
	t.Helper()
	require.NoError(t, model.DB.Where("1 = 1").Delete(&model.TicketMessage{}).Error)
	require.NoError(t, model.DB.Where("1 = 1").Delete(&model.Ticket{}).Error)
	require.NoError(t, model.DB.Where("1 = 1").Delete(&model.User{}).Error)
}

func insertTicketServiceUser(t *testing.T, id int, username string) {
	t.Helper()
	user := model.User{
		Id:       id,
		Username: username,
		Password: "unused-password-hash",
		AffCode:  strings.ToLower(username) + "-aff",
	}
	require.NoError(t, model.DB.Create(&user).Error)
}

func TestValidateTicketInputBoundaries(t *testing.T) {
	tests := []struct {
		name      string
		ticketTyp int
		title     string
		content   string
		wantType  int
		wantTitle string
		wantErr   error
	}{
		{name: "empty title rejected", ticketTyp: 1, title: "   ", content: "hello", wantErr: ErrTicketTitleLength},
		{name: "50 Chinese title accepted", ticketTyp: 1, title: strings.Repeat("标", 50), content: "hello", wantType: model.TicketTypeAPICall, wantTitle: strings.Repeat("标", 50)},
		{name: "51 Chinese title rejected", ticketTyp: 1, title: strings.Repeat("标", 51), content: "hello", wantErr: ErrTicketTitleLength},
		{name: "empty content rejected", ticketTyp: 1, title: "title", content: " \r\n ", wantErr: ErrTicketContentLength},
		{name: "1000 Chinese content accepted", ticketTyp: 1, title: "title", content: strings.Repeat("容", 1000), wantType: model.TicketTypeAPICall, wantTitle: "title"},
		{name: "1001 Chinese content rejected", ticketTyp: 1, title: "title", content: strings.Repeat("容", 1001), wantErr: ErrTicketContentLength},
		{name: "unknown type rejected", ticketTyp: 5, title: "title", content: "hello", wantErr: ErrTicketTypeInvalid},
		{name: "zero type normalized to api call", ticketTyp: 0, title: "title", content: "hello", wantType: model.TicketTypeAPICall, wantTitle: "title"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotType, gotTitle, gotContent, err := ValidateTicketInput(tt.ticketTyp, tt.title, tt.content)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.wantType, gotType)
			assert.Equal(t, tt.wantTitle, gotTitle)
			assert.NotEmpty(t, gotContent)
		})
	}
}

func TestValidateTicketInputNormalizesNewlines(t *testing.T) {
	// CRLF 归一化：不归一化时每个换行吃掉 2 个码点，会让同一段文字在 Windows 上「超限」
	gotType, _, gotContent, err := ValidateTicketInput(0, " title ", "a\r\nb")
	require.NoError(t, err)
	assert.Equal(t, model.TicketTypeAPICall, gotType)
	assert.Equal(t, "a\nb", gotContent)

	// 500 个 CRLF 组成的正文按 LF 计数后不超限；若不归一化会被误判 1000+ 字符
	content := strings.Repeat("x\r\n", 500)
	_, _, gotContent, err = ValidateTicketInput(1, "title", content)
	require.NoError(t, err)
	assert.NotContains(t, gotContent, "\r")

	_, _, gotContent, err = ValidateTicketInput(1, "title", "line1\rline2\r\nline3")
	require.NoError(t, err)
	assert.Equal(t, "line1\nline2\nline3", gotContent)
}

func TestCreateTicketForUserLimits(t *testing.T) {
	cleanupTicketServiceTables(t)
	insertTicketServiceUser(t, 1, "alice")

	now := int64(1757000000)
	todayStart := now - (now % 86400)
	yesterday := now - 86400
	yesterdayStart := todayStart - 86400

	// 未关闭工单数达到上限后新建被拒；关闭一个后可再建
	for i := 0; i < MaxTicketOpenPerUser; i++ {
		_, err := CreateTicketForUser(1, "alice", model.TicketTypeBilling, "billing issue", "content", true, todayStart, now)
		require.NoError(t, err)
	}
	_, err := CreateTicketForUser(1, "alice", model.TicketTypeBilling, "one more", "content", true, todayStart, now)
	assert.ErrorIs(t, err, model.ErrTicketOpenLimit)

	var tickets []*model.Ticket
	require.NoError(t, model.DB.Where("user_id = ?", 1).Find(&tickets).Error)
	require.Len(t, tickets, MaxTicketOpenPerUser)
	require.NoError(t, CloseSelfTicket(1, tickets[0].Id, now+1))
	_, err = CreateTicketForUser(1, "alice", model.TicketTypeBilling, "after close", "content", true, todayStart, now+2)
	assert.NoError(t, err)

	// 每日新建数达到上限后新建被拒；跨天后计数重置
	cleanupTicketServiceTables(t)
	insertTicketServiceUser(t, 1, "alice")
	for i := 0; i < MaxTicketPerUserPerDay; i++ {
		_, err := CreateTicketForUser(1, "alice", model.TicketTypeOther, "yesterday", "content", true, yesterdayStart, yesterday)
		require.NoError(t, err)
	}
	_, err = CreateTicketForUser(1, "alice", model.TicketTypeOther, "yesterday extra", "content", true, yesterdayStart, yesterday+1)
	assert.ErrorIs(t, err, model.ErrTicketDailyLimit)

	_, err = CreateTicketForUser(1, "alice", model.TicketTypeOther, "today", "content", true, todayStart, now)
	assert.NoError(t, err)
}

func TestCreateTicketForUserReturnsDetail(t *testing.T) {
	cleanupTicketServiceTables(t)
	insertTicketServiceUser(t, 1, "alice")

	now := int64(1757000000)
	detail, err := CreateTicketForUser(1, "alice", model.TicketTypeAccount, "cannot bind email", "step 1\r\nstep 2", true, now-3600, now)
	require.NoError(t, err)
	require.NotZero(t, detail.Id)
	assert.Equal(t, model.TicketTypeAccount, detail.Type)
	assert.Equal(t, 1, detail.MessageCount)
	assert.Equal(t, model.TicketStatusPending, detail.Status)
	assert.True(t, detail.CanReply)
	assert.True(t, detail.CanClose)
	require.Len(t, detail.Messages, 1)
	assert.Equal(t, "step 1\nstep 2", detail.Messages[0].Content)
	assert.Equal(t, model.TicketAuthorRoleUser, detail.Messages[0].AuthorRole)
	// 用户端不返回用户名快照
	assert.Empty(t, detail.Username)
	assert.False(t, detail.UnreadReply)
}

func TestSelfTicketOwnershipEnforcedAsNotFound(t *testing.T) {
	cleanupTicketServiceTables(t)
	insertTicketServiceUser(t, 1, "alice")
	insertTicketServiceUser(t, 2, "bob")

	now := int64(1757000000)
	detail, err := CreateTicketForUser(1, "alice", model.TicketTypeAPICall, "alice issue", "content", true, now-3600, now)
	require.NoError(t, err)

	// 用户 B 读 / 回复用户 A 的工单一律返回「不存在」而非「无权限」
	_, err = GetSelfTicketDetail(2, detail.Id, true, now+1)
	assert.ErrorIs(t, err, model.ErrTicketNotFound)

	err = ReplySelfTicket(2, "bob", detail.Id, "not mine", now+2)
	assert.ErrorIs(t, err, model.ErrTicketNotFound)

	err = CloseSelfTicket(2, detail.Id, now+3)
	assert.ErrorIs(t, err, model.ErrTicketNotFound)

	// 用户 A 正常回复（追问）后工单回到待处理
	require.NoError(t, ReplySelfTicket(1, "alice", detail.Id, "still there", now+4))
	stored, err := model.GetTicketById(detail.Id)
	require.NoError(t, err)
	assert.Equal(t, model.TicketStatusPending, stored.Status)
}

func TestReplySelfTicketValidatesContent(t *testing.T) {
	cleanupTicketServiceTables(t)
	insertTicketServiceUser(t, 1, "alice")

	now := int64(1757000000)
	detail, err := CreateTicketForUser(1, "alice", model.TicketTypeAPICall, "issue", "content", true, now-3600, now)
	require.NoError(t, err)

	err = ReplySelfTicket(1, "alice", detail.Id, "   ", now+1)
	assert.ErrorIs(t, err, ErrTicketContentLength)

	err = ReplySelfTicket(1, "alice", detail.Id, strings.Repeat("容", MaxTicketContentLength+1), now+2)
	assert.ErrorIs(t, err, ErrTicketContentLength)
}

func TestSelfTicketUnreadLifecycle(t *testing.T) {
	cleanupTicketServiceTables(t)
	insertTicketServiceUser(t, 1, "alice")

	now := int64(1757000000)
	detail, err := CreateTicketForUser(1, "alice", model.TicketTypeAPICall, "issue", "content", true, now-3600, now)
	require.NoError(t, err)

	unread, err := CountSelfTicketUnread(1)
	require.NoError(t, err)
	assert.Equal(t, int64(0), unread)

	// 管理员回复 → 未读成立，列表视图 UnreadReply=true
	require.NoError(t, ReplyTicketAsAdmin(99, "admin", detail.Id, "fixed", now+10))
	unread, err = CountSelfTicketUnread(1)
	require.NoError(t, err)
	assert.Equal(t, int64(1), unread)

	views, total, err := ListSelfTicketsForUser(1, 0, 0, 0, 10)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	assert.True(t, views[0].UnreadReply)

	// 用户打开详情 → 已读，两处提示同时消失
	opened, err := GetSelfTicketDetail(1, detail.Id, true, now+20)
	require.NoError(t, err)
	require.Len(t, opened.Messages, 2)

	unread, err = CountSelfTicketUnread(1)
	require.NoError(t, err)
	assert.Equal(t, int64(0), unread)
	views, total, err = ListSelfTicketsForUser(1, 0, 0, 0, 10)
	require.NoError(t, err)
	assert.False(t, views[0].UnreadReply)
}

func TestAdminTicketViewsAndStats(t *testing.T) {
	cleanupTicketServiceTables(t)
	insertTicketServiceUser(t, 1, "alice")
	insertTicketServiceUser(t, 2, "bob")

	now := int64(1757000000)
	first, err := CreateTicketForUser(1, "alice", model.TicketTypeAPICall, "alice issue", "content", true, now-3600, now)
	require.NoError(t, err)
	_, err = CreateTicketForUser(2, "bob", model.TicketTypeBilling, "bob issue", "content", true, now-3600, now)
	require.NoError(t, err)
	require.NoError(t, ReplyTicketAsAdmin(99, "admin", first.Id, "fixed", now+10))

	// 管理端统计：1 待处理（bob）+ 1 已回复（alice）
	stats, err := GetTicketStats()
	require.NoError(t, err)
	assert.Equal(t, int64(1), stats.Pending)
	assert.Equal(t, int64(1), stats.Replied)
	assert.Equal(t, int64(2), stats.Total)

	// 管理端详情返回用户名快照且不带未读标记；关键词同时匹配标题与用户名
	adminDetail, err := GetTicketDetailForAdmin(first.Id)
	require.NoError(t, err)
	assert.Equal(t, "alice", adminDetail.Username)
	assert.False(t, adminDetail.UnreadReply)

	views, total, err := ListTicketsForAdmin(model.TicketListFilter{Keyword: "bob"}, 0, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "bob", views[0].Username)

	// user 过滤：纯数字按 user_id，否则按用户名精确匹配
	views, total, err = ListTicketsForAdmin(model.TicketListFilter{User: "2"}, 0, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "bob", views[0].Username)

	// 管理端删除工单后消息一并消失
	require.NoError(t, DeleteTicketByAdmin(first.Id))
	_, err = model.GetTicketById(first.Id)
	assert.ErrorIs(t, err, model.ErrTicketNotFound)
	var messageCount int64
	require.NoError(t, model.DB.Model(&model.TicketMessage{}).Where("ticket_id = ?", first.Id).Count(&messageCount).Error)
	assert.Zero(t, messageCount)
}
