package model

import (
	"slices"
	"strings"
	"time"

	"gorm.io/gorm/clause"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/risk_setting"
)

// TokenRiskEvent 记录令牌共享/分发风控的检测事件，仅管理员可见。
// 同一令牌、同一事件类型、同一小时桶只保留一条（唯一索引 + OnConflict DoNothing），
// 实现天然的事件限频，防止随机 UA 攻击刷爆事件表。
type TokenRiskEvent struct {
	// Id 是数据库主键。
	Id int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	// UserId 是触发事件的令牌所属用户 ID。fp_cross_user 事件记指纹关联用户数最多的那个用户。
	UserId int `json:"user_id" gorm:"index:idx_risk_user_time,priority:1;not null"`
	// TokenId 是触发事件的令牌 ID。fp_cross_user 事件无单一令牌归属时记 0。
	TokenId int `json:"token_id" gorm:"uniqueIndex:idx_risk_token_type_hour,priority:1;not null"`
	// EventType 是事件类型：concurrent_fp / single_fp_concurrency / fp_burst / fp_cross_user。
	EventType string `json:"event_type" gorm:"size:32;uniqueIndex:idx_risk_token_type_hour,priority:2;not null"`
	// HourBucket 是事件发生的小时桶（Unix 秒，整点），与 token/type 组成唯一索引去重。
	HourBucket int64 `json:"hour_bucket" gorm:"uniqueIndex:idx_risk_token_type_hour,priority:3;not null"`
	// Evidence 是证据快照 JSON（并发指纹数、指纹列表、关联用户数等），仅管理员接口返回。
	Evidence string `json:"evidence" gorm:"type:text"`
	// Status 是处理状态：0 待处理，1 已忽略。
	Status int `json:"status" gorm:"default:0;index"`
	// CreatedTime 是事件创建时间戳（秒）。
	CreatedTime int64 `json:"created_time" gorm:"index"`
}

func (TokenRiskEvent) TableName() string {
	return "token_risk_events"
}

// RecordTokenRiskEvent 幂等写入一条风控事件。唯一索引 (token_id, event_type, hour_bucket)
// 冲突时静默跳过，保证同令牌同类型事件每小时最多一条。
func RecordTokenRiskEvent(event *TokenRiskEvent) error {
	if event.CreatedTime == 0 {
		event.CreatedTime = time.Now().Unix()
	}
	return DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "token_id"},
			{Name: "event_type"},
			{Name: "hour_bucket"},
		},
		DoNothing: true,
	}).Create(event).Error
}

// tokenRiskEventHourBucket 返回当前小时桶的整点 Unix 时间戳。
func tokenRiskEventHourBucket(now time.Time) int64 {
	return now.Unix() - int64(now.Minute())*60 - int64(now.Second())
}

// TokenRiskEventFilter 是风控事件列表查询的过滤条件。
type TokenRiskEventFilter struct {
	Status    *int
	EventType string
	UserId    *int
	TokenId   *int
}

// GetTokenRiskEvents 分页查询风控事件，按创建时间倒序。
func GetTokenRiskEvents(filter TokenRiskEventFilter, startIdx int, num int) ([]TokenRiskEvent, int64, error) {
	query := DB.Model(&TokenRiskEvent{})
	if filter.Status != nil {
		query = query.Where("status = ?", *filter.Status)
	}
	if filter.EventType != "" {
		query = query.Where("event_type = ?", filter.EventType)
	}
	if filter.UserId != nil {
		query = query.Where("user_id = ?", *filter.UserId)
	}
	if filter.TokenId != nil {
		query = query.Where("token_id = ?", *filter.TokenId)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var events []TokenRiskEvent
	err := query.Order("created_time DESC, id DESC").Offset(startIdx).Limit(num).Find(&events).Error
	return events, total, err
}

// UpdateTokenRiskEventStatus 更新事件处理状态。
func UpdateTokenRiskEventStatus(id int64, status int) error {
	return DB.Model(&TokenRiskEvent{}).Where("id = ?", id).Update("status", status).Error
}

// DeleteTokenRiskEventsByUserIds 删除给定用户的所有风控事件（按行聚合视图的批量删除）。
// 返回实际删除的行数。
func DeleteTokenRiskEventsByUserIds(userIds []int) (int64, error) {
	if len(userIds) == 0 {
		return 0, nil
	}
	result := DB.Where("user_id IN ?", userIds).Delete(&TokenRiskEvent{})
	return result.RowsAffected, result.Error
}

// GetUsernamesByIds 批量返回用户 ID 到用户名的映射，供风控证据展示具体账号。
// 已删除或不存在的用户不在结果中，调用方需自行处理缺失的用户名。
func GetUsernamesByIds(ids []int) map[int]string {
	usernames := make(map[int]string, len(ids))
	if len(ids) == 0 {
		return usernames
	}
	var users []User
	if err := DB.Select("id, username").Where("id IN ?", ids).Find(&users).Error; err != nil {
		common.SysError("token risk username query failed: " + err.Error())
		return usernames
	}
	for _, user := range users {
		usernames[user.Id] = user.Username
	}
	return usernames
}

// TokenRiskUserSummary 是按用户聚合的疑似分发用户视图行。
// 事件计数按各信号类型分列；LatestEvidence 取该用户最新一条事件的证据，
// Signals 则按信号类型分别保留最新一条，避免最新事件不是 fp_cross_user 时
// 跨用户账号证据被覆盖掉。
type TokenRiskUserSummary struct {
	UserId             int    `json:"user_id"`
	Username           string `json:"username"`
	EventCount         int64  `json:"event_count"`
	ConcurrentFpCount  int64  `json:"concurrent_fp_count"`
	SingleFpCount      int64  `json:"single_fp_count"`
	FpBurstCount       int64  `json:"fp_burst_count"`
	FpCrossUserCount   int64  `json:"fp_cross_user_count"`
	PendingCount       int64  `json:"pending_count"`
	InvolvedTokenCount int64  `json:"involved_token_count"`
	LatestEventTime    int64  `json:"latest_event_time"`
	LatestEventType    string `json:"latest_event_type"`
	LatestEvidence     string `json:"latest_evidence"`
	// Signals 由聚合查询后单独补充，不是表字段。
	Signals []TokenRiskUserSignal `json:"signals" gorm:"-"`
}

// TokenRiskUserSignal 是某用户某一种信号类型最新事件的证据快照。
type TokenRiskUserSignal struct {
	// EventType 是信号类型，取值与 TokenRiskEvent.EventType 一致。
	EventType string `json:"event_type"`
	// Evidence 是该信号最新事件的证据 JSON。
	Evidence string `json:"evidence"`
	// CreatedTime 是该信号最新事件的创建时间戳（秒）。
	CreatedTime int64 `json:"created_time"`
}

// GetTokenRiskUserSummaries 分页返回按用户聚合的疑似分发用户列表，
// 按最新事件时间倒序。聚合只使用标准 GORM Group/Sum/Max，三种数据库通用。
func GetTokenRiskUserSummaries(filter TokenRiskEventFilter, startIdx int, num int) ([]TokenRiskUserSummary, int64, error) {
	query := DB.Model(&TokenRiskEvent{})
	if filter.Status != nil {
		query = query.Where("status = ?", *filter.Status)
	}
	if filter.EventType != "" {
		query = query.Where("event_type = ?", filter.EventType)
	}
	var total int64
	grouped := query.Select("user_id").Group("user_id")
	if err := DB.Table("(?) AS risk_users", grouped).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []TokenRiskUserSummary
	err := query.Select(
		"user_id, " +
			"COUNT(*) AS event_count, " +
			"SUM(CASE WHEN event_type = 'concurrent_fp' THEN 1 ELSE 0 END) AS concurrent_fp_count, " +
			"SUM(CASE WHEN event_type = 'single_fp_concurrency' THEN 1 ELSE 0 END) AS single_fp_count, " +
			"SUM(CASE WHEN event_type = 'fp_burst' THEN 1 ELSE 0 END) AS fp_burst_count, " +
			"SUM(CASE WHEN event_type = 'fp_cross_user' THEN 1 ELSE 0 END) AS fp_cross_user_count, " +
			"SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) AS pending_count, " +
			"COUNT(DISTINCT token_id) AS involved_token_count, " +
			"MAX(created_time) AS latest_event_time").
		Group("user_id").Order("latest_event_time DESC").
		Offset(startIdx).Limit(num).Scan(&items).Error
	if err != nil {
		return nil, 0, err
	}
	attachRiskUsernamesAndEvidence(items)
	return items, total, nil
}

// attachRiskUsernamesAndEvidence 为聚合行补充用户名，以及每用户最新事件和
// 各信号类型最新事件的证据。MAX(id) GROUP BY user_id（, event_type）子查询取
// 每组最新事件，在三种数据库下行为一致。
func attachRiskUsernamesAndEvidence(items []TokenRiskUserSummary) {
	if len(items) == 0 {
		return
	}
	userIds := make([]int, 0, len(items))
	for _, item := range items {
		userIds = append(userIds, item.UserId)
	}
	usernameById := GetUsernamesByIds(userIds)
	for i := range items {
		items[i].Username = usernameById[items[i].UserId]
	}
	latestSub := DB.Model(&TokenRiskEvent{}).
		Select("MAX(id) AS id").
		Where("user_id IN ?", userIds).
		Group("user_id, event_type")
	var signalEvents []TokenRiskEvent
	if err := DB.Where("id IN (?)", latestSub).Find(&signalEvents).Error; err != nil {
		common.SysError("token risk latest events query failed: " + err.Error())
		return
	}
	signalsByUser := make(map[int][]TokenRiskUserSignal, len(items))
	latestByUser := make(map[int]*TokenRiskEvent, len(items))
	for i := range signalEvents {
		event := &signalEvents[i]
		signalsByUser[event.UserId] = append(signalsByUser[event.UserId], TokenRiskUserSignal{
			EventType:   event.EventType,
			Evidence:    event.Evidence,
			CreatedTime: event.CreatedTime,
		})
		if latest, ok := latestByUser[event.UserId]; !ok || event.Id > latest.Id {
			latestByUser[event.UserId] = event
		}
	}
	for i := range items {
		signals := signalsByUser[items[i].UserId]
		slices.SortFunc(signals, func(a, b TokenRiskUserSignal) int {
			return strings.Compare(a.EventType, b.EventType)
		})
		items[i].Signals = signals
		if latest, ok := latestByUser[items[i].UserId]; ok {
			items[i].LatestEventType = latest.EventType
			items[i].LatestEvidence = latest.Evidence
		}
	}
}

// RecordTokenRiskEventFromSample 是中间件与每日任务共用的事件写入入口，
// 跳过白名单令牌并按小时桶去重。
func RecordTokenRiskEventFromSample(userId, tokenId int, eventType string, evidence string, now time.Time) {
	if risk_setting.IsTrustedToken(tokenId) {
		return
	}
	err := RecordTokenRiskEvent(&TokenRiskEvent{
		UserId:     userId,
		TokenId:    tokenId,
		EventType:  eventType,
		HourBucket: tokenRiskEventHourBucket(now),
		Evidence:   evidence,
	})
	if err != nil {
		common.SysError("failed to record token risk event: " + err.Error())
	}
}
