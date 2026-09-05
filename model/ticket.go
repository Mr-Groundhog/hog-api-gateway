package model

import (
	"errors"
	"strconv"

	"gorm.io/gorm"
)

// 工单状态。取值沿用「1 启用 / 2 停用」式的非零约定，避免 Go 零值与业务状态混淆；
// 升序即「待处理 → 已回复 → 已关闭」，可直接用于排序。
const (
	TicketStatusPending = 1 // 待处理：用户已提交或已追问，等待管理员响应
	TicketStatusReplied = 2 // 已回复：管理员已回复，等待用户确认或追问
	TicketStatusClosed  = 3 // 已关闭：不再接受新消息
)

// 工单分类，固定 4 种，不支持自定义。
const (
	TicketTypeAPICall = 1 // api调用
	TicketTypeAccount = 2 // 账号问题
	TicketTypeBilling = 3 // 账单问题
	TicketTypeOther   = 4 // 其他
)

// 一条工单消息的发送方身份。
const (
	TicketAuthorRoleUser  = 1 // 由提单用户发出
	TicketAuthorRoleAdmin = 2 // 由管理员发出
)

var (
	ErrTicketNotFound      = errors.New("工单不存在")
	ErrTicketClosed        = errors.New("工单已关闭")
	ErrTicketStatusInvalid = errors.New("无效的工单状态")
	ErrTicketMessageLimit  = errors.New("工单消息数已达上限")
	ErrTicketOpenLimit     = errors.New("未关闭的工单数已达上限")
	ErrTicketDailyLimit    = errors.New("今日新建工单数已达上限")
)

// Ticket 描述一张用户提交的工单。工单本身只保存元信息与会话游标，
// 正文与每一次回复都存在 ticket_messages 中（首条消息即用户提交的工单内容）。
// 表名：tickets
type Ticket struct {
	Id       int    `json:"id" gorm:"primaryKey;autoIncrement"`                         // 主键，自增 ID
	UserId   int    `json:"user_id" gorm:"not null;index:idx_ticket_user_updated"`      // 提单用户 ID，与 UpdatedTime 组成联合索引用于「我的工单」按更新时间倒序分页
	Username string `json:"username" gorm:"type:varchar(64);not null;default:'';index"` // 提单时的用户名快照，用户改名或注销后管理端列表仍可读
	Type     int    `json:"type" gorm:"not null;index"`                                 // 工单类型，取 TicketType* 之一；默认 TicketTypeAPICall
	Title    string `json:"title" gorm:"type:varchar(191);not null"`                    // 工单标题，业务上限 50 个字符（按 Unicode 码点计），列宽留余量以容纳 4 字节字符
	Status   int    `json:"status" gorm:"not null;index:idx_ticket_status_reply"`       // 工单状态，取 TicketStatus*；升序即「待处理 → 已回复 → 已关闭」，可直接用于排序

	// MessageCount 是会话内消息总数（含用户提交的首条），由回复事务原子自增，用于列表展示与消息数上限判定。
	MessageCount int `json:"message_count" gorm:"not null;default:0"`
	// LastAdminReplyTime 是最后一条管理员消息的时间（Unix 秒）；0 表示管理员从未回复。
	// 与 UserReadTime 比较即得出用户是否有未读回复，是「管理员已回复」标记与侧边栏红点的唯一数据来源。
	LastAdminReplyTime int64 `json:"last_admin_reply_time" gorm:"bigint;not null;default:0"`
	// LastReplyTime 是最后一条消息（不区分发送方）的时间（Unix 秒），仅用于列表排序与展示，
	// 避免把排序建立在跨方言行为不一致的表达式上。
	LastReplyTime int64 `json:"last_reply_time" gorm:"bigint;not null;index:idx_ticket_status_reply"`
	// UserReadTime 是提单用户最后一次打开该工单详情的时间（Unix 秒）。
	// 用户未读 <=> LastAdminReplyTime > UserReadTime，该判定幂等，重复标记已读无副作用。
	// 有意不设对应的管理员已读列：管理端待办由 Status = TicketStatusPending 直接派生。
	UserReadTime int64 `json:"user_read_time" gorm:"bigint;not null;default:0"`
	ClosedTime   int64 `json:"closed_time" gorm:"bigint;not null;default:0"`                      // 关闭时间（Unix 秒），0 表示未关闭；重开时清零
	CreatedTime  int64 `json:"created_time" gorm:"bigint;not null"`                               // 工单创建时间（Unix 秒）
	UpdatedTime  int64 `json:"updated_time" gorm:"bigint;not null;index:idx_ticket_user_updated"` // 最后一次变更时间（Unix 秒），任何消息或状态变化都会刷新
}

func (Ticket) TableName() string {
	return "tickets"
}

// TicketMessage 是工单会话中的一条消息。首条消息（AuthorRole = user，序号最小）即
// 用户提交工单时填写的正文，后续为管理员回复与用户追问，按 Id 升序即会话顺序。
// 表名：ticket_messages
type TicketMessage struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`                        // 主键，自增 ID
	TicketId    int    `json:"ticket_id" gorm:"not null;index:idx_ticket_message_thread"` // 所属工单 ID（对应 tickets 主键），单列索引用于定位会话
	UserId      int    `json:"user_id" gorm:"not null;default:0"`                         // 消息发送者的用户 ID；管理员回复时为该管理员的 ID
	Username    string `json:"username" gorm:"type:varchar(64);not null;default:''"`      // 发送者用户名快照，账号变更后历史会话仍可读
	AuthorRole  int    `json:"author_role" gorm:"not null"`                               // 发送方身份，取 TicketAuthorRole*；决定前端气泡左右与「管理员」标签
	Content     string `json:"content" gorm:"type:text;not null"`                         // 消息正文，纯文本；保留换行、不解析任何标记语言，业务上限 1000 个字符（按 Unicode 码点计）
	CreatedTime int64  `json:"created_time" gorm:"bigint;not null"`                       // 发送时间（Unix 秒），仅用于展示；秒级精度不足以单独决定会话顺序
}

func (TicketMessage) TableName() string {
	return "ticket_messages"
}

// TicketListFilter 是工单列表的查询条件。零值字段表示该条件不生效；
// Keyword/User 仅管理端使用，UserId 仅用户端使用（>0 时强制按提单用户过滤）。
type TicketListFilter struct {
	UserId    int    // 限定提单用户 ID，0 表示不过滤（管理端全量）
	Status    int    // 按状态过滤，0 表示不过滤
	Type      int    // 按工单类型过滤，0 表示不过滤
	Keyword   string // 模糊匹配工单标题或用户名（管理端）
	User      string // 精确匹配提单用户：纯数字按 user_id，否则按 username（管理端）
	StartTime int64  // created_time >= StartTime，0 表示不设下界
	EndTime   int64  // created_time <= EndTime，0 表示不设上界
}

func buildTicketListQuery(filter TicketListFilter) *gorm.DB {
	query := DB.Model(&Ticket{})
	if filter.UserId > 0 {
		query = query.Where("user_id = ?", filter.UserId)
	}
	if filter.Status != 0 {
		query = query.Where("status = ?", filter.Status)
	}
	if filter.Type != 0 {
		query = query.Where("type = ?", filter.Type)
	}
	if filter.Keyword != "" {
		like := "%" + filter.Keyword + "%"
		query = query.Where("title LIKE ? OR username LIKE ?", like, like)
	}
	if filter.User != "" {
		// 纯数字按 user_id 精确匹配，否则按用户名快照精确匹配
		if userId, err := strconv.Atoi(filter.User); err == nil {
			query = query.Where("user_id = ?", userId)
		} else {
			query = query.Where("username = ?", filter.User)
		}
	}
	if filter.StartTime > 0 {
		query = query.Where("created_time >= ?", filter.StartTime)
	}
	if filter.EndTime > 0 {
		query = query.Where("created_time <= ?", filter.EndTime)
	}
	return query
}

// GetTicketsByFilter 返回按「状态升序 → 最后消息时间倒序 → ID 倒序」排序的工单列表。
// status 升序天然等于「待处理 → 已回复 → 已关闭」，管理端从上往下即可清待办队列；
// 索引 idx_ticket_status_reply(status, last_reply_time) 直接命中。
func GetTicketsByFilter(filter TicketListFilter, startIdx int, num int) ([]*Ticket, int64, error) {
	var total int64
	if err := buildTicketListQuery(filter).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var tickets []*Ticket
	err := buildTicketListQuery(filter).
		Order("status ASC, last_reply_time DESC, id DESC").
		Limit(num).
		Offset(startIdx).
		Find(&tickets).Error
	return tickets, total, err
}

// GetTicketById 按主键读取一张工单。
func GetTicketById(id int) (*Ticket, error) {
	if id <= 0 {
		return nil, ErrTicketNotFound
	}
	ticket := &Ticket{}
	err := DB.First(ticket, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrTicketNotFound
	}
	if err != nil {
		return nil, err
	}
	return ticket, nil
}

// GetTicketMessages 按会话顺序（Id 升序）返回某工单的全部消息。
// created_time 是秒级精度，同一秒内写入的两条消息顺序在不同数据库下不稳定，
// 自增主键天然单调，因此会话顺序以 Id 为权威。
func GetTicketMessages(ticketId int) ([]*TicketMessage, error) {
	var messages []*TicketMessage
	err := DB.Where("ticket_id = ?", ticketId).
		Order("id ASC").
		Find(&messages).Error
	return messages, err
}

// CountUserUnreadTickets 统计某用户有未读管理员回复的工单数。
// last_admin_reply_time > user_read_time 的两列比较在三种数据库上语法一致，
// 先由 user_id 收敛后量级极小，无需额外索引。
func CountUserUnreadTickets(userId int) (int64, error) {
	var count int64
	err := DB.Model(&Ticket{}).
		Where("user_id = ? AND last_admin_reply_time > user_read_time", userId).
		Count(&count).Error
	return count, err
}

// CountTicketsByStatus 返回各状态的工单数（缺省状态不出现在结果中）。
func CountTicketsByStatus() (map[int]int64, error) {
	var rows []struct {
		Status int
		Total  int64
	}
	err := DB.Model(&Ticket{}).
		Select("status, COUNT(*) AS total").
		Group("status").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	counts := make(map[int]int64, len(rows))
	for _, row := range rows {
		counts[row.Status] = row.Total
	}
	return counts, nil
}

// CreateTicket 在单个事务内新建工单并写入首条消息。
// 事务内先锁住提单用户的 users 行把同一用户的新建串行化，再检查未关闭数与当日
// 新建数上限——不锁用户行时，双击或多端并发提交会让多个请求都读到「未达上限」
// 然后各插一条，绕过限制。SQLite 跳过行锁，但其单写者模型天然串行，同样安全。
// dayStart 是当日零点（Unix 秒），由调用方按服务器本地时区计算。
func CreateTicket(ticket *Ticket, firstMessage *TicketMessage, maxOpenPerUser int, maxPerUserPerDay int, dayStart int64, now int64) error {
	if ticket.UserId <= 0 {
		return ErrTicketNotFound
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		user := &User{}
		if err := lockForUpdate(tx).First(user, "id = ?", ticket.UserId).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTicketNotFound
			}
			return err
		}

		var openCount int64
		if err := tx.Model(&Ticket{}).
			Where("user_id = ? AND status <> ?", ticket.UserId, TicketStatusClosed).
			Count(&openCount).Error; err != nil {
			return err
		}
		if openCount >= int64(maxOpenPerUser) {
			return ErrTicketOpenLimit
		}

		var dailyCount int64
		if err := tx.Model(&Ticket{}).
			Where("user_id = ? AND created_time >= ?", ticket.UserId, dayStart).
			Count(&dailyCount).Error; err != nil {
			return err
		}
		if dailyCount >= int64(maxPerUserPerDay) {
			return ErrTicketDailyLimit
		}

		ticket.Status = TicketStatusPending
		ticket.MessageCount = 1
		ticket.LastAdminReplyTime = 0
		ticket.LastReplyTime = now
		ticket.UserReadTime = now // 首条消息是用户自己写的，不算未读
		ticket.ClosedTime = 0
		ticket.CreatedTime = now
		ticket.UpdatedTime = now
		if err := tx.Create(ticket).Error; err != nil {
			return err
		}

		firstMessage.TicketId = ticket.Id
		firstMessage.CreatedTime = now
		return tx.Create(firstMessage).Error
	})
}

// AppendTicketMessage 在单个事务内完成一次回复/追问：锁工单行、校验状态与消息数
// 上限、插入消息并原子刷新会话游标。ownerId > 0 时（用户端）强制校验工单归属，
// 越权与不存在一样返回 ErrTicketNotFound，避免探测工单是否存在。
// 管理员回复 → Replied 并刷新 LastAdminReplyTime（用户侧未读由此成立）；
// 用户追问 → Pending 并把 UserReadTime 推进到当前时间（顺带清掉残留未读）。
// UPDATE 的 WHERE 再带一次 status <> closed，用 RowsAffected 兜住「读到未关闭、
// 写时已被并发关闭」的竞态，整体回滚保证消息不落库。
func AppendTicketMessage(ticketId int, ownerId int, senderId int, senderName string, authorRole int, content string, maxMessages int, now int64) error {
	if ticketId <= 0 {
		return ErrTicketNotFound
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		ticket := &Ticket{}
		query := lockForUpdate(tx)
		if ownerId > 0 {
			query = query.Where("user_id = ?", ownerId)
		}
		if err := query.First(ticket, "id = ?", ticketId).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTicketNotFound
			}
			return err
		}
		if ticket.Status == TicketStatusClosed {
			return ErrTicketClosed
		}
		if ticket.MessageCount >= maxMessages {
			return ErrTicketMessageLimit
		}

		message := &TicketMessage{
			TicketId:    ticketId,
			UserId:      senderId,
			Username:    senderName,
			AuthorRole:  authorRole,
			Content:     content,
			CreatedTime: now,
		}
		if err := tx.Create(message).Error; err != nil {
			return err
		}

		updates := map[string]interface{}{
			"message_count":   gorm.Expr("message_count + ?", 1),
			"last_reply_time": now,
			"updated_time":    now,
		}
		if authorRole == TicketAuthorRoleAdmin {
			updates["status"] = TicketStatusReplied
			updates["last_admin_reply_time"] = now
		} else {
			updates["status"] = TicketStatusPending
			updates["user_read_time"] = now
		}

		result := tx.Model(&Ticket{}).
			Where("id = ? AND status <> ?", ticketId, TicketStatusClosed).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrTicketClosed // 并发关闭时整体回滚
		}
		return nil
	})
}

// MarkTicketReadByUser 把工单标记为用户已读（UserReadTime = now）。
// 幂等的单条更新，重复调用无副作用；只有用户端存在这个动作，
// 管理端详情是纯读操作，不写任何状态。
func MarkTicketReadByUser(ticketId int, userId int, now int64) error {
	result := DB.Model(&Ticket{}).
		Where("id = ? AND user_id = ?", ticketId, userId).
		Update("user_read_time", now)
	return result.Error
}

// CloseSelfTicket 用户关闭自己的工单。先确认存在且归属，再把「不存在」与「已关闭」
// 区分开：条件更新 WHERE status <> closed 未命中时是已关闭态，按幂等成功处理，
// 不刷新 updated_time；多端并发点「关闭」不会互相报错。
func CloseSelfTicket(ticketId int, userId int, now int64) error {
	if ticketId <= 0 {
		return ErrTicketNotFound
	}
	var count int64
	if err := DB.Model(&Ticket{}).
		Where("id = ? AND user_id = ?", ticketId, userId).
		Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return ErrTicketNotFound
	}
	result := DB.Model(&Ticket{}).
		Where("id = ? AND user_id = ? AND status <> ?", ticketId, userId, TicketStatusClosed).
		Updates(map[string]interface{}{
			"status":       TicketStatusClosed,
			"closed_time":  now,
			"updated_time": now,
		})
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// AdminUpdateTicketStatus 承载管理端仅有的两种状态语义：关闭（Pending/Replied →
// Closed）与重开（Closed → Pending）。其余目标流转一律拒绝，避免绕过
// 「重开只从关闭态出发」的语义。重复关闭已关闭的工单是幂等成功：不刷新
// updated_time、不写审计；对非关闭态重开则被条件更新拒绝。
func AdminUpdateTicketStatus(ticketId int, targetStatus int, now int64) error {
	if ticketId <= 0 {
		return ErrTicketNotFound
	}
	if targetStatus != TicketStatusClosed && targetStatus != TicketStatusPending {
		return ErrTicketStatusInvalid
	}
	ticket, err := GetTicketById(ticketId)
	if err != nil {
		return err
	}
	if targetStatus == TicketStatusClosed {
		if ticket.Status == TicketStatusClosed {
			return nil // 幂等成功
		}
		result := DB.Model(&Ticket{}).
			Where("id = ? AND status <> ?", ticketId, TicketStatusClosed).
			Updates(map[string]interface{}{
				"status":       TicketStatusClosed,
				"closed_time":  now,
				"updated_time": now,
			})
		if result.Error != nil {
			return result.Error
		}
		return nil
	}
	// 重开：条件更新天然防并发重复重开与对未关闭工单重开
	result := DB.Model(&Ticket{}).
		Where("id = ? AND status = ?", ticketId, TicketStatusClosed).
		Updates(map[string]interface{}{
			"status":       TicketStatusPending,
			"closed_time":  0,
			"updated_time": now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTicketStatusInvalid
	}
	return nil
}

// DeleteTicketById 在单个事务内删除工单及其全部消息，两条写同生共死，
// 避免留下查不到父工单的孤儿消息。
func DeleteTicketById(ticketId int) error {
	if ticketId <= 0 {
		return ErrTicketNotFound
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("ticket_id = ?", ticketId).Delete(&TicketMessage{}).Error; err != nil {
			return err
		}
		result := tx.Delete(&Ticket{}, ticketId)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrTicketNotFound
		}
		return nil
	})
}
