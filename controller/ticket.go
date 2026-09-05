package controller

import (
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
)

// ticketErrorKeys 把 service / model 层返回的业务错误映射成 i18n 键；
// 未登记的错误原样透传给 common.ApiError。
var ticketErrorKeys = []struct {
	err error
	key string
}{
	{model.ErrTicketNotFound, i18n.MsgTicketNotFound},
	{model.ErrTicketClosed, i18n.MsgTicketClosed},
	{model.ErrTicketStatusInvalid, i18n.MsgTicketStatusInvalid},
	{model.ErrTicketMessageLimit, i18n.MsgTicketMessageLimit},
	{model.ErrTicketOpenLimit, i18n.MsgTicketOpenLimit},
	{model.ErrTicketDailyLimit, i18n.MsgTicketDailyLimit},
	{service.ErrTicketTypeInvalid, i18n.MsgTicketTypeInvalid},
	{service.ErrTicketTitleLength, i18n.MsgTicketTitleLength},
	{service.ErrTicketContentLength, i18n.MsgTicketContentLength},
}

func apiTicketError(c *gin.Context, err error) {
	for _, mapping := range ticketErrorKeys {
		if err == mapping.err {
			common.ApiErrorI18n(c, mapping.key)
			return
		}
	}
	common.ApiError(c, err)
}

// parseTicketId 解析路径参数中的工单 ID。非数字的 :id 按不存在返回而不是 500，
// 与「/self/unread 与 /self/:id 并存，静态段优先」的路由布局配套。
func parseTicketId(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorI18n(c, i18n.MsgTicketNotFound)
		return 0, false
	}
	return id, true
}

// parseTicketStatusType 解析列表查询里的 status / type 过滤参数，
// 缺省或非法值统一按 0（不过滤）处理。
func parseTicketStatusType(c *gin.Context) (int, int) {
	status, _ := strconv.Atoi(c.Query("status"))
	ticketType, _ := strconv.Atoi(c.Query("type"))
	return status, ticketType
}

// GetSelfTickets 返回当前用户自己的工单列表，支持 status / type + 分页。
func GetSelfTickets(c *gin.Context) {
	userId := c.GetInt("id")
	status, ticketType := parseTicketStatusType(c)
	pageInfo := common.GetPageQuery(c)
	views, total, err := service.ListSelfTicketsForUser(userId, status, ticketType, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(views)
	common.ApiSuccess(c, pageInfo)
}

// GetSelfTicketUnread 返回当前用户的未读管理员回复数，驱动侧边栏红点。
func GetSelfTicketUnread(c *gin.Context) {
	userId := c.GetInt("id")
	count, err := service.CountSelfTicketUnread(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, count)
}

// GetSelfTicket 返回用户自己的工单详情；打开详情即视为已读，
// 服务端在返回会话消息之后写 user_read_time。
func GetSelfTicket(c *gin.Context) {
	userId := c.GetInt("id")
	ticketId, ok := parseTicketId(c)
	if !ok {
		return
	}
	writeEnabled := setting.IsSidebarModuleEnabled("personal", "ticket")
	detail, err := service.GetSelfTicketDetail(userId, ticketId, writeEnabled, time.Now().Unix())
	if err != nil {
		apiTicketError(c, err)
		return
	}
	common.ApiSuccess(c, detail)
}

// CreateTicket 新建工单。受功能开关与用户级限流约束，成功后直接返回
// 新工单的详情视图（含 id 与首条消息），前端无需刷新列表反查。
func CreateTicket(c *gin.Context) {
	userId := c.GetInt("id")
	var req struct {
		Type    int    `json:"type"`
		Title   string `json:"title"`
		Content string `json:"content"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	now := time.Now()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	writeEnabled := setting.IsSidebarModuleEnabled("personal", "ticket")
	detail, err := service.CreateTicketForUser(userId, c.GetString("username"), req.Type, req.Title, req.Content, writeEnabled, dayStart, now.Unix())
	if err != nil {
		apiTicketError(c, err)
		return
	}
	common.ApiSuccess(c, detail)
}

// ReplySelfTicket 用户追问自己的工单，工单回到待处理队列。
func ReplySelfTicket(c *gin.Context) {
	userId := c.GetInt("id")
	ticketId, ok := parseTicketId(c)
	if !ok {
		return
	}
	var req struct {
		Content string `json:"content"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := service.ReplySelfTicket(userId, c.GetString("username"), ticketId, req.Content, time.Now().Unix()); err != nil {
		apiTicketError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// CloseSelfTicket 用户关闭自己的工单。用户自己关闭工单不是高危操作，不写审计。
func CloseSelfTicket(c *gin.Context) {
	userId := c.GetInt("id")
	ticketId, ok := parseTicketId(c)
	if !ok {
		return
	}
	if err := service.CloseSelfTicket(userId, ticketId, time.Now().Unix()); err != nil {
		apiTicketError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// GetAllTickets 管理端返回全部工单，支持 status / type / keyword（标题或用户名
// 模糊）/ user（数字按 user_id，否则按 username 精确）/ start_time / end_time + 分页。
func GetAllTickets(c *gin.Context) {
	status, ticketType := parseTicketStatusType(c)
	pageInfo := common.GetPageQuery(c)
	filter := model.TicketListFilter{
		Status:  status,
		Type:    ticketType,
		Keyword: c.Query("keyword"),
		User:    c.Query("user"),
	}
	if startTime, err := strconv.ParseInt(c.Query("start_time"), 10, 64); err == nil {
		filter.StartTime = startTime
	}
	if endTime, err := strconv.ParseInt(c.Query("end_time"), 10, 64); err == nil {
		filter.EndTime = endTime
	}
	views, total, err := service.ListTicketsForAdmin(filter, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(views)
	common.ApiSuccess(c, pageInfo)
}

// GetTicketStats 管理端工单概览；pending 同时供侧边栏「工单管理」徽标使用。
func GetTicketStats(c *gin.Context) {
	stats, err := service.GetTicketStats()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, stats)
}

// GetTicketDetail 管理端查看工单详情。纯读操作，不写任何已读状态。
func GetTicketDetail(c *gin.Context) {
	ticketId, ok := parseTicketId(c)
	if !ok {
		return
	}
	detail, err := service.GetTicketDetailForAdmin(ticketId)
	if err != nil {
		apiTicketError(c, err)
		return
	}
	common.ApiSuccess(c, detail)
}

// ReplyTicket 管理员回复工单，工单进入已回复状态并成立用户侧未读。
func ReplyTicket(c *gin.Context) {
	ticketId, ok := parseTicketId(c)
	if !ok {
		return
	}
	ticket, err := model.GetTicketById(ticketId)
	if err != nil {
		apiTicketError(c, err)
		return
	}
	var req struct {
		Content string `json:"content"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := service.ReplyTicketAsAdmin(c.GetInt("id"), c.GetString("username"), ticketId, req.Content, time.Now().Unix()); err != nil {
		apiTicketError(c, err)
		return
	}
	recordManageAudit(c, "ticket.reply", map[string]interface{}{
		"id":       ticketId,
		"username": ticket.Username,
	})
	common.ApiSuccess(c, nil)
}

// ticketStatusLabel 把目标状态转成审计文案里的可读标签。
func ticketStatusLabel(status int) string {
	if status == model.TicketStatusClosed {
		return "closed"
	}
	if status == model.TicketStatusPending {
		return "pending"
	}
	return strconv.Itoa(status)
}

// UpdateTicketStatus 管理端仅承载两种语义：关闭（Pending/Replied → Closed，重复
// 关闭幂等成功）与重开（Closed → Pending），其余目标流转由服务层拒绝。
func UpdateTicketStatus(c *gin.Context) {
	ticketId, ok := parseTicketId(c)
	if !ok {
		return
	}
	var req struct {
		Status int `json:"status"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	now := time.Now().Unix()
	if err := service.UpdateTicketStatusByAdmin(ticketId, req.Status, now); err != nil {
		apiTicketError(c, err)
		return
	}
	recordManageAudit(c, "ticket.status_update", map[string]interface{}{
		"id":     ticketId,
		"status": ticketStatusLabel(req.Status),
	})
	common.ApiSuccess(c, nil)
}

// DeleteTicket 管理端删除工单及其全部会话记录。
func DeleteTicket(c *gin.Context) {
	ticketId, ok := parseTicketId(c)
	if !ok {
		return
	}
	ticket, err := model.GetTicketById(ticketId)
	if err != nil {
		apiTicketError(c, err)
		return
	}
	if err := service.DeleteTicketByAdmin(ticketId); err != nil {
		apiTicketError(c, err)
		return
	}
	recordManageAudit(c, "ticket.delete", map[string]interface{}{
		"id":       ticketId,
		"username": ticket.Username,
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    nil,
	})
}
