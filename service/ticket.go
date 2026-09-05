package service

import (
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/model"
)

// 工单的配置边界。这些都是防滥用上限而非计费乘数，工单链路完全不触碰额度，
// 因此不涉及额度饱和 / QuotaFromFloat 那套约束。
const (
	MaxTicketTitleLength   = 50   // 工单标题字符数上限（Unicode 码点）
	MaxTicketContentLength = 1000 // 单条消息字符数上限（Unicode 码点）
	MaxTicketOpenPerUser   = 5    // 单用户同时未关闭的工单数上限
	MaxTicketPerUserPerDay = 10   // 单用户每日新建工单数上限
	MaxTicketMessages      = 100  // 单个工单的消息总数上限
)

var (
	ErrTicketTypeInvalid   = errors.New("无效的工单类型")
	ErrTicketTitleLength   = errors.New("工单标题长度必须在 1 到 50 个字符之间")
	ErrTicketContentLength = errors.New("工单内容长度必须在 1 到 1000 个字符之间")
)

// TicketListItemView 是工单列表中的一行。UnreadReply 由后端算好，前端不重复实现判定规则。
type TicketListItemView struct {
	Id            int    `json:"id"`
	UserId        int    `json:"userId"`
	Username      string `json:"username"` // 仅管理端返回，用户端置空
	Type          int    `json:"type"`
	Title         string `json:"title"`
	Status        int    `json:"status"`
	MessageCount  int    `json:"messageCount"`
	UnreadReply   bool   `json:"unreadReply"` // 仅用户端使用：管理员已回复且用户尚未查看，驱动「管理员已回复」标记；管理端恒为 false
	LastReplyTime int64  `json:"lastReplyTime"`
	CreatedTime   int64  `json:"createdTime"`
}

// TicketMessageView 是会话中的一条消息。
type TicketMessageView struct {
	Id          int    `json:"id"`
	AuthorRole  int    `json:"authorRole"`
	Username    string `json:"username"`
	Content     string `json:"content"` // 纯文本，含换行；前端用 whitespace-pre-wrap 原样展示
	CreatedTime int64  `json:"createdTime"`
}

// TicketDetailView 是工单详情：元信息 + 完整会话。
type TicketDetailView struct {
	TicketListItemView
	Messages []TicketMessageView `json:"messages"`
	CanReply bool                `json:"canReply"` // 综合状态、开关、消息数上限判定，前端据此禁用输入
	CanClose bool                `json:"canClose"`
}

// TicketStatsView 是管理端的工单概览。pending 即待办队列长度，无需任何已读游标。
type TicketStatsView struct {
	Pending int64 `json:"pending"` // 待处理
	Replied int64 `json:"replied"` // 已回复
	Closed  int64 `json:"closed"`  // 已关闭
	Total   int64 `json:"total"`
}

// NormalizeTicketContent 把 Windows 浏览器提交的 CRLF 与孤立 CR 统一成 LF 并去掉
// 首尾空白。不归一化会让每个换行吃掉 2 个码点，导致同一段文字在不同系统上
// 「有的能提交、有的超限」，且前端字数计数与后端不一致。
func NormalizeTicketContent(content string) string {
	content = strings.ReplaceAll(content, "\r\n", "\n")
	content = strings.ReplaceAll(content, "\r", "\n")
	return strings.TrimSpace(content)
}

// ValidateTicketInput 归一化并校验用户提交的工单类型 / 标题 / 内容。
// 长度一律按 Unicode 码点计数（utf8.RuneCountInString），与「50 字 / 1000 字」的
// 中文语义一致。类型缺省（0）归一化为 api调用。
func ValidateTicketInput(ticketType int, title string, content string) (int, string, string, error) {
	if ticketType == 0 {
		ticketType = model.TicketTypeAPICall
	}
	switch ticketType {
	case model.TicketTypeAPICall, model.TicketTypeAccount, model.TicketTypeBilling, model.TicketTypeOther:
	default:
		return 0, "", "", ErrTicketTypeInvalid
	}

	title = strings.TrimSpace(title)
	titleLength := utf8.RuneCountInString(title)
	if titleLength == 0 || titleLength > MaxTicketTitleLength {
		return 0, "", "", ErrTicketTitleLength
	}

	content = NormalizeTicketContent(content)
	contentLength := utf8.RuneCountInString(content)
	if contentLength == 0 || contentLength > MaxTicketContentLength {
		return 0, "", "", ErrTicketContentLength
	}
	return ticketType, title, content, nil
}

// toTicketListItemView 把模型行转成列表视图。includeUsername 仅管理端为 true，
// unreadReply 仅用户端计算——管理端没有任何已读状态。
func toTicketListItemView(ticket *model.Ticket, includeUsername bool, withUnread bool) TicketListItemView {
	view := TicketListItemView{
		Id:            ticket.Id,
		UserId:        ticket.UserId,
		Type:          ticket.Type,
		Title:         ticket.Title,
		Status:        ticket.Status,
		MessageCount:  ticket.MessageCount,
		LastReplyTime: ticket.LastReplyTime,
		CreatedTime:   ticket.CreatedTime,
	}
	if includeUsername {
		view.Username = ticket.Username
	}
	if withUnread {
		view.UnreadReply = ticket.LastAdminReplyTime > ticket.UserReadTime
	}
	return view
}

func toTicketMessageView(message *model.TicketMessage) TicketMessageView {
	return TicketMessageView{
		Id:          message.Id,
		AuthorRole:  message.AuthorRole,
		Username:    message.Username,
		Content:     message.Content,
		CreatedTime: message.CreatedTime,
	}
}

// buildTicketDetailView 组装详情视图。canReply/canClose 由后端判定并下发，
// 前端只负责渲染，避免前后端两套规则漂移。canWriteEnabled 反映用户端写开关，
// 管理端恒为 true（管理员需要在关闭功能后处理完存量工单）。
func buildTicketDetailView(ticket *model.Ticket, messages []*model.TicketMessage, includeUsername bool, withUnread bool, writeEnabled bool) *TicketDetailView {
	detail := &TicketDetailView{
		TicketListItemView: toTicketListItemView(ticket, includeUsername, withUnread),
		Messages:           make([]TicketMessageView, 0, len(messages)),
	}
	for _, message := range messages {
		detail.Messages = append(detail.Messages, toTicketMessageView(message))
	}
	detail.CanReply = writeEnabled && ticket.Status != model.TicketStatusClosed && ticket.MessageCount < MaxTicketMessages
	detail.CanClose = ticket.Status != model.TicketStatusClosed
	return detail
}

// ListSelfTicketsForUser 返回当前用户自己的工单列表（按状态升序 → 最后消息时间倒序）。
func ListSelfTicketsForUser(userId int, status int, ticketType int, startIdx int, pageSize int) ([]TicketListItemView, int64, error) {
	tickets, total, err := model.GetTicketsByFilter(model.TicketListFilter{
		UserId: userId,
		Status: status,
		Type:   ticketType,
	}, startIdx, pageSize)
	if err != nil {
		return nil, 0, err
	}
	views := make([]TicketListItemView, 0, len(tickets))
	for _, ticket := range tickets {
		views = append(views, toTicketListItemView(ticket, false, true))
	}
	return views, total, nil
}

// CountSelfTicketUnread 返回当前用户有未读管理员回复的工单数，驱动侧边栏红点。
func CountSelfTicketUnread(userId int) (int64, error) {
	return model.CountUserUnreadTickets(userId)
}

// GetSelfTicketDetail 返回用户自己的工单详情，并把该工单标记为已读。
// 实现顺序固定为「先加载会话消息，再以加载完成后的当前时间写 user_read_time」，
// 确保本次已经返回给用户看的回复一定被判定为已读。越权与不存在一样按
// 「工单不存在」处理，避免通过错误码探测工单是否存在。
// writeEnabled 反映用户端写开关（管理员级侧边栏模块配置），由调用方传入。
func GetSelfTicketDetail(userId int, ticketId int, writeEnabled bool, now int64) (*TicketDetailView, error) {
	ticket, messages, err := getTicketWithMessagesForOwner(userId, ticketId)
	if err != nil {
		return nil, err
	}
	if err := model.MarkTicketReadByUser(ticketId, userId, now); err != nil {
		return nil, err
	}
	return buildTicketDetailView(ticket, messages, false, true, writeEnabled), nil
}

// getTicketWithMessagesForOwner 读取属于指定用户的工单及其会话消息。
func getTicketWithMessagesForOwner(userId int, ticketId int) (*model.Ticket, []*model.TicketMessage, error) {
	ticket, err := model.GetTicketById(ticketId)
	if err != nil {
		return nil, nil, model.ErrTicketNotFound
	}
	if ticket.UserId != userId {
		return nil, nil, model.ErrTicketNotFound
	}
	messages, err := model.GetTicketMessages(ticketId)
	if err != nil {
		return nil, nil, err
	}
	return ticket, messages, nil
}

// CreateTicketForUser 校验并新建一张工单，返回含首条消息的详情视图，
// 供前端「提交成功后自动打开新工单详情」。
// writeEnabled 反映用户端写开关，由调用方传入（调用中间件已拦截关闭态）。
func CreateTicketForUser(userId int, username string, ticketType int, title string, content string, writeEnabled bool, dayStart int64, now int64) (*TicketDetailView, error) {
	ticketType, title, content, err := ValidateTicketInput(ticketType, title, content)
	if err != nil {
		return nil, err
	}
	ticket := &model.Ticket{
		UserId:   userId,
		Username: username,
		Type:     ticketType,
		Title:    title,
	}
	firstMessage := &model.TicketMessage{
		UserId:     userId,
		Username:   username,
		AuthorRole: model.TicketAuthorRoleUser,
		Content:    content,
	}
	if err := model.CreateTicket(ticket, firstMessage, MaxTicketOpenPerUser, MaxTicketPerUserPerDay, dayStart, now); err != nil {
		return nil, err
	}
	return buildTicketDetailView(ticket, []*model.TicketMessage{firstMessage}, false, true, writeEnabled), nil
}

// ReplySelfTicket 以用户身份追问自己的工单，工单回到待处理队列。
func ReplySelfTicket(userId int, username string, ticketId int, content string, now int64) error {
	content = NormalizeTicketContent(content)
	contentLength := utf8.RuneCountInString(content)
	if contentLength == 0 || contentLength > MaxTicketContentLength {
		return ErrTicketContentLength
	}
	return model.AppendTicketMessage(ticketId, userId, userId, username, model.TicketAuthorRoleUser, content, MaxTicketMessages, now)
}

// CloseSelfTicket 用户关闭自己的工单。
func CloseSelfTicket(userId int, ticketId int, now int64) error {
	return model.CloseSelfTicket(ticketId, userId, now)
}

// ListTicketsForAdmin 返回管理端的工单列表，附带用户名快照。
func ListTicketsForAdmin(filter model.TicketListFilter, startIdx int, pageSize int) ([]TicketListItemView, int64, error) {
	tickets, total, err := model.GetTicketsByFilter(filter, startIdx, pageSize)
	if err != nil {
		return nil, 0, err
	}
	views := make([]TicketListItemView, 0, len(tickets))
	for _, ticket := range tickets {
		views = append(views, toTicketListItemView(ticket, true, false))
	}
	return views, total, nil
}

// GetTicketStats 返回管理端按状态分组的工单计数。
func GetTicketStats() (*TicketStatsView, error) {
	counts, err := model.CountTicketsByStatus()
	if err != nil {
		return nil, err
	}
	stats := &TicketStatsView{
		Pending: counts[model.TicketStatusPending],
		Replied: counts[model.TicketStatusReplied],
		Closed:  counts[model.TicketStatusClosed],
	}
	stats.Total = stats.Pending + stats.Replied + stats.Closed
	return stats, nil
}

// GetTicketDetailForAdmin 返回管理端的工单详情。管理端没有任何已读状态，
// 该接口是纯读操作，无副作用，可随意重试、预取、并发打开。
func GetTicketDetailForAdmin(ticketId int) (*TicketDetailView, error) {
	ticket, err := model.GetTicketById(ticketId)
	if err != nil {
		return nil, err
	}
	messages, err := model.GetTicketMessages(ticketId)
	if err != nil {
		return nil, err
	}
	return buildTicketDetailView(ticket, messages, true, false, true), nil
}

// ReplyTicketAsAdmin 以管理员身份回复工单，工单进入已回复状态并成立用户侧未读。
func ReplyTicketAsAdmin(adminId int, adminName string, ticketId int, content string, now int64) error {
	content = NormalizeTicketContent(content)
	contentLength := utf8.RuneCountInString(content)
	if contentLength == 0 || contentLength > MaxTicketContentLength {
		return ErrTicketContentLength
	}
	return model.AppendTicketMessage(ticketId, 0, adminId, adminName, model.TicketAuthorRoleAdmin, content, MaxTicketMessages, now)
}

// UpdateTicketStatusByAdmin 承载管理端仅有的两种状态语义：关闭与重开。
func UpdateTicketStatusByAdmin(ticketId int, status int, now int64) error {
	return model.AdminUpdateTicketStatus(ticketId, status, now)
}

// DeleteTicketByAdmin 删除工单及其全部会话记录。
func DeleteTicketByAdmin(ticketId int) error {
	return model.DeleteTicketById(ticketId)
}
