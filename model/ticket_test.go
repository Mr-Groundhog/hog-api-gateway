package model

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func cleanupTicketTables(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.Where("1 = 1").Delete(&TicketMessage{}).Error)
	require.NoError(t, DB.Where("1 = 1").Delete(&Ticket{}).Error)
	require.NoError(t, DB.Where("1 = 1").Delete(&User{}).Error)
}

func insertTicketTestUser(t *testing.T, id int, username string) {
	t.Helper()
	user := User{
		Id:       id,
		Username: username,
		Password: "unused-password-hash",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
		AffCode:  strings.ToLower(username) + "-aff",
	}
	require.NoError(t, DB.Create(&user).Error)
}

func insertTestTicket(t *testing.T, userId int, username string, status int, now int64) *Ticket {
	t.Helper()
	ticket := &Ticket{
		UserId:        userId,
		Username:      username,
		Type:          TicketTypeAPICall,
		Title:         "test ticket",
		Status:        TicketStatusPending,
		MessageCount:  1,
		LastReplyTime: now,
		UserReadTime:  now,
		CreatedTime:   now,
		UpdatedTime:   now,
	}
	require.NoError(t, DB.Create(ticket).Error)
	first := &TicketMessage{
		TicketId:    ticket.Id,
		UserId:      userId,
		Username:    username,
		AuthorRole:  TicketAuthorRoleUser,
		Content:     "first message",
		CreatedTime: now,
	}
	require.NoError(t, DB.Create(first).Error)
	if status != TicketStatusPending {
		require.NoError(t, DB.Model(ticket).Update("status", status).Error)
	}
	return ticket
}

func TestCreateTicketStateFlow(t *testing.T) {
	cleanupTicketTables(t)
	insertTicketTestUser(t, 1, "alice")

	now := common.GetTimestamp()
	ticket := &Ticket{
		UserId:   1,
		Username: "alice",
		Type:     TicketTypeAPICall,
		Title:    "api 429",
	}
	firstMessage := &TicketMessage{
		UserId:     1,
		Username:   "alice",
		AuthorRole: TicketAuthorRoleUser,
		Content:    "getting 429",
	}
	require.NoError(t, CreateTicket(ticket, firstMessage, 5, 10, now-3600, now))
	require.NotZero(t, ticket.Id)

	var stored Ticket
	require.NoError(t, DB.First(&stored, "id = ?", ticket.Id).Error)
	assert.Equal(t, TicketStatusPending, stored.Status)
	assert.Equal(t, 1, stored.MessageCount)
	assert.Equal(t, now, stored.LastReplyTime)
	assert.Equal(t, now, stored.UserReadTime)
	assert.Zero(t, stored.LastAdminReplyTime)
	assert.Zero(t, stored.ClosedTime)

	// 管理员回复 → 已回复，未读成立
	require.NoError(t, AppendTicketMessage(ticket.Id, 0, 99, "admin", TicketAuthorRoleAdmin, "fixed", 100, now+10))
	require.NoError(t, DB.First(&stored, "id = ?", ticket.Id).Error)
	assert.Equal(t, TicketStatusReplied, stored.Status)
	assert.Equal(t, 2, stored.MessageCount)
	assert.Equal(t, now+10, stored.LastAdminReplyTime)

	unread, err := CountUserUnreadTickets(1)
	require.NoError(t, err)
	assert.Equal(t, int64(1), unread)

	// 用户打开详情 → 已读，重复标记幂等
	require.NoError(t, MarkTicketReadByUser(ticket.Id, 1, now+20))
	require.NoError(t, MarkTicketReadByUser(ticket.Id, 1, now+20))
	unread, err = CountUserUnreadTickets(1)
	require.NoError(t, err)
	assert.Equal(t, int64(0), unread)

	// 用户追问 → 回到待处理，顺带清掉残留未读
	require.NoError(t, AppendTicketMessage(ticket.Id, 1, 1, "alice", TicketAuthorRoleUser, "still failing", 100, now+30))
	require.NoError(t, DB.First(&stored, "id = ?", ticket.Id).Error)
	assert.Equal(t, TicketStatusPending, stored.Status)
	assert.Equal(t, now+30, stored.UserReadTime)
	unread, err = CountUserUnreadTickets(1)
	require.NoError(t, err)
	assert.Equal(t, int64(0), unread)
}

func TestAdminPendingCountIgnoresDetailView(t *testing.T) {
	cleanupTicketTables(t)
	insertTicketTestUser(t, 1, "alice")

	now := common.GetTimestamp()
	ticket := insertTestTicket(t, 1, "alice", TicketStatusPending, now)

	pendingBefore, err := CountTicketsByStatus()
	require.NoError(t, err)
	require.Equal(t, int64(1), pendingBefore[TicketStatusPending])

	// 管理端打开详情是纯读操作：不写任何状态，待办计数不变
	_, err = GetTicketById(ticket.Id)
	require.NoError(t, err)
	_, err = GetTicketMessages(ticket.Id)
	require.NoError(t, err)
	pendingAfter, err := CountTicketsByStatus()
	require.NoError(t, err)
	assert.Equal(t, int64(1), pendingAfter[TicketStatusPending])

	// 只有真正回复才让工单离队，待办计数 -1
	require.NoError(t, AppendTicketMessage(ticket.Id, 0, 99, "admin", TicketAuthorRoleAdmin, "reply", 100, now+5))
	pendingReplied, err := CountTicketsByStatus()
	require.NoError(t, err)
	assert.Equal(t, int64(0), pendingReplied[TicketStatusPending])
	assert.Equal(t, int64(1), pendingReplied[TicketStatusReplied])
}

func TestAppendTicketMessageOnClosedTicketRejected(t *testing.T) {
	cleanupTicketTables(t)
	insertTicketTestUser(t, 1, "alice")

	now := common.GetTimestamp()
	ticket := insertTestTicket(t, 1, "alice", TicketStatusClosed, now)
	closedAt := now + 1
	require.NoError(t, DB.Model(ticket).Updates(map[string]interface{}{
		"closed_time":  closedAt,
		"updated_time": closedAt,
	}).Error)

	err := AppendTicketMessage(ticket.Id, 1, 1, "alice", TicketAuthorRoleUser, "reopen me", 100, now+2)
	assert.ErrorIs(t, err, ErrTicketClosed)

	var stored Ticket
	require.NoError(t, DB.First(&stored, "id = ?", ticket.Id).Error)
	assert.Equal(t, 1, stored.MessageCount)

	var messageCount int64
	require.NoError(t, DB.Model(&TicketMessage{}).Where("ticket_id = ?", ticket.Id).Count(&messageCount).Error)
	assert.Equal(t, int64(1), messageCount)

	// 用户端越权读/写一律按「不存在」处理
	err = AppendTicketMessage(ticket.Id, 2, 2, "bob", TicketAuthorRoleUser, "not mine", 100, now+3)
	assert.ErrorIs(t, err, ErrTicketNotFound)
}

func TestAppendTicketMessageLimit(t *testing.T) {
	cleanupTicketTables(t)
	insertTicketTestUser(t, 1, "alice")

	now := common.GetTimestamp()
	ticket := insertTestTicket(t, 1, "alice", TicketStatusReplied, now)

	// 已有 1 条首消息，上限 2：再回复 1 条成功，之后被拒
	require.NoError(t, AppendTicketMessage(ticket.Id, 1, 1, "alice", TicketAuthorRoleUser, "second", 2, now+5))
	err := AppendTicketMessage(ticket.Id, 0, 99, "admin", TicketAuthorRoleAdmin, "third", 2, now+6)
	assert.ErrorIs(t, err, ErrTicketMessageLimit)

	var stored Ticket
	require.NoError(t, DB.First(&stored, "id = ?", ticket.Id).Error)
	assert.Equal(t, 2, stored.MessageCount)
}

func TestTicketMessagesOrderedByIdOnSameSecond(t *testing.T) {
	cleanupTicketTables(t)
	insertTicketTestUser(t, 1, "alice")

	now := common.GetTimestamp()
	ticket := insertTestTicket(t, 1, "alice", TicketStatusPending, now)

	// 同一秒写入的两条消息：created_time 相同，会话顺序必须按 Id 升序
	require.NoError(t, AppendTicketMessage(ticket.Id, 0, 99, "admin", TicketAuthorRoleAdmin, "first", 100, now))
	require.NoError(t, AppendTicketMessage(ticket.Id, 1, 1, "alice", TicketAuthorRoleUser, "second", 100, now))

	messages, err := GetTicketMessages(ticket.Id)
	require.NoError(t, err)
	require.Len(t, messages, 3)
	assert.Equal(t, "first message", messages[0].Content)
	assert.Equal(t, "first", messages[1].Content)
	assert.Equal(t, "second", messages[2].Content)
	assert.Equal(t, now, messages[1].CreatedTime)
	assert.Equal(t, now, messages[2].CreatedTime)
}

func TestCloseSelfTicketIdempotent(t *testing.T) {
	cleanupTicketTables(t)
	insertTicketTestUser(t, 1, "alice")

	now := common.GetTimestamp()
	ticket := insertTestTicket(t, 1, "alice", TicketStatusReplied, now)

	require.NoError(t, CloseSelfTicket(ticket.Id, 1, now+10))
	var stored Ticket
	require.NoError(t, DB.First(&stored, "id = ?", ticket.Id).Error)
	assert.Equal(t, TicketStatusClosed, stored.Status)
	assert.Equal(t, now+10, stored.ClosedTime)

	// 重复关闭幂等成功：不刷新 updated_time
	require.NoError(t, CloseSelfTicket(ticket.Id, 1, now+20))
	require.NoError(t, DB.First(&stored, "id = ?", ticket.Id).Error)
	assert.Equal(t, now+10, stored.UpdatedTime)

	// 不属于自己的工单按「不存在」处理
	insertTicketTestUser(t, 2, "bob")
	other := insertTestTicket(t, 2, "bob", TicketStatusPending, now)
	assert.ErrorIs(t, CloseSelfTicket(other.Id, 1, now+30), ErrTicketNotFound)
}

func TestAdminUpdateTicketStatusTransitions(t *testing.T) {
	cleanupTicketTables(t)
	insertTicketTestUser(t, 1, "alice")

	now := common.GetTimestamp()
	replied := insertTestTicket(t, 1, "alice", TicketStatusReplied, now)

	// 重开仅允许从关闭态出发，对已回复工单重开被拒
	assert.ErrorIs(t, AdminUpdateTicketStatus(replied.Id, TicketStatusPending, now+1), ErrTicketStatusInvalid)

	// 关闭 → 重开 → 待处理
	require.NoError(t, AdminUpdateTicketStatus(replied.Id, TicketStatusClosed, now+2))
	require.NoError(t, AdminUpdateTicketStatus(replied.Id, TicketStatusClosed, now+3)) // 重复关闭幂等成功
	var stored Ticket
	require.NoError(t, DB.First(&stored, "id = ?", replied.Id).Error)
	assert.Equal(t, now+2, stored.UpdatedTime)

	require.NoError(t, AdminUpdateTicketStatus(replied.Id, TicketStatusPending, now+4))
	require.NoError(t, DB.First(&stored, "id = ?", replied.Id).Error)
	assert.Equal(t, TicketStatusPending, stored.Status)
	assert.Zero(t, stored.ClosedTime)

	// 其余目标状态一律拒绝
	assert.ErrorIs(t, AdminUpdateTicketStatus(replied.Id, TicketStatusReplied, now+5), ErrTicketStatusInvalid)
}

func TestCreateTicketLimits(t *testing.T) {
	cleanupTicketTables(t)
	insertTicketTestUser(t, 1, "alice")

	now := common.GetTimestamp()
	dayStart := now - 3600

	newTicket := func() *Ticket {
		return &Ticket{
			UserId:   1,
			Username: "alice",
			Type:     TicketTypeAPICall,
			Title:    "limit test",
		}
	}
	newMessage := func() *TicketMessage {
		return &TicketMessage{
			UserId:     1,
			Username:   "alice",
			AuthorRole: TicketAuthorRoleUser,
			Content:    "content",
		}
	}

	// 未关闭工单数达到上限后新建被拒；关闭一个后可再建
	first := newTicket()
	require.NoError(t, CreateTicket(first, newMessage(), 2, 10, dayStart, now))
	require.NoError(t, CreateTicket(newTicket(), newMessage(), 2, 10, dayStart, now))
	assert.ErrorIs(t, CreateTicket(newTicket(), newMessage(), 2, 10, dayStart, now), ErrTicketOpenLimit)

	require.NoError(t, CloseSelfTicket(first.Id, 1, now+1))
	require.NoError(t, CreateTicket(newTicket(), newMessage(), 2, 10, dayStart, now))

	// 当日新建数达到上限后新建被拒，与未关闭数无关
	assert.ErrorIs(t, CreateTicket(newTicket(), newMessage(), 5, 3, dayStart, now), ErrTicketDailyLimit)
}

func TestGetTicketsByFilterStatusOrderAndOwnership(t *testing.T) {
	cleanupTicketTables(t)
	insertTicketTestUser(t, 1, "alice")
	insertTicketTestUser(t, 2, "bob")

	now := common.GetTimestamp()
	closed := insertTestTicket(t, 1, "alice", TicketStatusClosed, now)
	require.NoError(t, DB.Model(closed).Update("last_reply_time", now+100).Error)
	replied := insertTestTicket(t, 1, "alice", TicketStatusReplied, now)
	require.NoError(t, DB.Model(replied).Update("last_reply_time", now+200).Error)
	pending := insertTestTicket(t, 1, "alice", TicketStatusPending, now)
	other := insertTestTicket(t, 2, "bob", TicketStatusPending, now)

	// status 升序即「待处理 → 已回复 → 已关闭」，待处理天然排在最前
	tickets, total, err := GetTicketsByFilter(TicketListFilter{UserId: 1}, 0, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(3), total)
	assert.Equal(t, []int{pending.Id, replied.Id, closed.Id}, []int{tickets[0].Id, tickets[1].Id, tickets[2].Id})

	// 用户端过滤：user_id 强制收敛，看不到他人的工单
	tickets, total, err = GetTicketsByFilter(TicketListFilter{UserId: 2}, 0, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, other.Id, tickets[0].Id)

	// 关键词同时匹配标题与用户名
	tickets, total, err = GetTicketsByFilter(TicketListFilter{Keyword: "bob"}, 0, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, other.Id, tickets[0].Id)
}

func TestDeleteTicketByIdRemovesMessages(t *testing.T) {
	cleanupTicketTables(t)
	insertTicketTestUser(t, 1, "alice")

	now := common.GetTimestamp()
	ticket := insertTestTicket(t, 1, "alice", TicketStatusPending, now)
	require.NoError(t, AppendTicketMessage(ticket.Id, 0, 99, "admin", TicketAuthorRoleAdmin, "reply", 100, now+5))

	require.NoError(t, DeleteTicketById(ticket.Id))

	var ticketCount, messageCount int64
	require.NoError(t, DB.Model(&Ticket{}).Where("id = ?", ticket.Id).Count(&ticketCount).Error)
	require.NoError(t, DB.Model(&TicketMessage{}).Where("ticket_id = ?", ticket.Id).Count(&messageCount).Error)
	assert.Zero(t, ticketCount)
	assert.Zero(t, messageCount)

	assert.ErrorIs(t, DeleteTicketById(ticket.Id), ErrTicketNotFound)
}
