package model

import (
	"time"
)

// AI 审核来源与判定结果的固定取值，同时用作数据库列的枚举值。
const (
	// AIReviewSourceSampled 表示请求由抽检选中送审。
	AIReviewSourceSampled = "sampled"
	// AIReviewSourceSensitiveHit 表示请求因命中敏感词被拦截后送 AI 复核。
	AIReviewSourceSensitiveHit = "sensitive_hit"
	// AIReviewVerdictFlagged 表示 AI 判定疑似违规，等待管理员复核。
	AIReviewVerdictFlagged = "flagged"
	// AIReviewVerdictSafe 表示 AI 判定无违规；敏感词命中来源的该类记录用于甄别
	// 误伤，抽检来源的该类记录仅在开启抽检全量留痕后落库。
	AIReviewVerdictSafe = "safe"
	// AIReviewVerdictError 表示审核调用失败；敏感词命中来源始终落库，抽检来源
	// 仅在开启抽检全量留痕后落库。
	AIReviewVerdictError = "error"
)

// AI 审核记录的处理状态。
const (
	// AIReviewStatusPending 表示记录待管理员复核。
	AIReviewStatusPending = 0
	// AIReviewStatusConfirmed 表示管理员已确认违规。
	AIReviewStatusConfirmed = 1
	// AIReviewStatusDismissed 表示管理员判定为误报并忽略。
	AIReviewStatusDismissed = 2
	// AIReviewStatusNoActionNeeded 表示系统已归档、无需管理员处理的留痕记录，
	// 仅用于开启抽检全量留痕后落库的抽检通过或调用失败记录。
	AIReviewStatusNoActionNeeded = 3
)

// AIReviewRecord 记录一次事后 AI 内容审核的送审摘录、判定结论与管理员复核结果。
type AIReviewRecord struct {
	// Id is the database primary key.
	Id int `json:"id" gorm:"primaryKey;autoIncrement"`
	// UserId identifies the user whose request was reviewed; zero means unauthenticated.
	UserId int `json:"user_id" gorm:"index:idx_ai_review_user_verdict_time,priority:1"`
	// Username stores the username snapshot for stable administrator reporting.
	Username string `json:"username" gorm:"type:varchar(64);index"`
	// TokenId identifies the API token used by the reviewed request.
	TokenId int `json:"token_id"`
	// TokenName stores the token name snapshot at review time.
	TokenName string `json:"token_name" gorm:"type:varchar(128)"`
	// Ip stores the client IP address observed by the gateway.
	Ip string `json:"ip" gorm:"type:varchar(64);index"`
	// UserAgent stores the client user-agent header.
	UserAgent string `json:"user_agent" gorm:"type:varchar(512)"`
	// RequestPath stores the API path that received the reviewed request.
	RequestPath string `json:"request_path" gorm:"type:varchar(255)"`
	// GroupName stores the user group used for sensitive-check scoping; named
	// group_name to avoid the reserved word `group`.
	GroupName string `json:"group_name" gorm:"type:varchar(64);index;column:group_name"`
	// ModelName stores the requested model name.
	ModelName string `json:"model_name" gorm:"type:varchar(255)"`
	// RequestId links the reviewed request to its consume log entry.
	RequestId string `json:"request_id" gorm:"type:varchar(64);index"`
	// Source records why the request was reviewed: sampled or sensitive_hit.
	Source string `json:"source" gorm:"type:varchar(32);index"`
	// MatchedWords stores the sensitive words matched before AI review as a JSON
	// array; empty for sampled reviews.
	MatchedWords string `json:"matched_words" gorm:"type:text"`
	// RequestExcerpt stores the bounded request excerpt sent to the reviewer:
	// a per-role JSON envelope for sampled reviews, or the flattened excerpt
	// reused from the sensitive-word block for sensitive_hit reviews.
	RequestExcerpt string `json:"request_excerpt" gorm:"type:text"`
	// Verdict stores the AI verdict: flagged, safe, or error.
	Verdict string `json:"verdict" gorm:"type:varchar(16);index:idx_ai_review_user_verdict_time,priority:2"`
	// Category stores the fixed violation category code assigned by the reviewer.
	Category string `json:"category" gorm:"type:varchar(32)"`
	// Confidence stores the reviewer's confidence in [0,1].
	Confidence float64 `json:"confidence"`
	// Reason stores the reviewer's one-sentence verdict rationale in Simplified
	// Chinese (bounded to about 200 characters); the full evidence is the
	// RequestExcerpt.
	Reason string `json:"reason" gorm:"type:varchar(1024)"`
	// AdminStatus stores the administrator review state: 0 pending, 1 confirmed,
	// 2 dismissed, 3 no action needed (audit trail of clean sampled reviews).
	AdminStatus int `json:"admin_status" gorm:"index"`
	// AdminId stores the id of the administrator who handled the record.
	AdminId int `json:"admin_id"`
	// AdminUsername stores the username snapshot of the handling administrator.
	AdminUsername string `json:"admin_username" gorm:"type:varchar(64)"`
	// AdminComment stores the administrator's optional handling note.
	AdminComment string `json:"admin_comment" gorm:"type:varchar(1024)"`
	// ActionTaken stores what was done about the violation: none, warned, or banned.
	ActionTaken string `json:"action_taken" gorm:"type:varchar(16)"`
	// HandledAt stores the handling timestamp as Unix seconds; zero while pending.
	HandledAt int64 `json:"handled_at"`
	// CreatedAt stores the review creation timestamp as Unix seconds.
	CreatedAt int64 `json:"created_at" gorm:"index:idx_ai_review_user_verdict_time,priority:3;index"`
}

// TableName overrides the default pluralized table name.
func (AIReviewRecord) TableName() string {
	return "ai_review_records"
}

// RecordAIReview persists one AI review result for administrator review.
func RecordAIReview(record *AIReviewRecord) error {
	if record.CreatedAt == 0 {
		record.CreatedAt = time.Now().Unix()
	}
	return DB.Create(record).Error
}

// CountAIReviewFlaggedSince returns how many flagged reviews a user accumulated
// since the given Unix timestamp; used by the rolling auto-ban window.
func CountAIReviewFlaggedSince(userId int, since int64) (int64, error) {
	var count int64
	err := DB.Model(&AIReviewRecord{}).
		Where("user_id = ? AND verdict = ? AND created_at >= ?", userId, AIReviewVerdictFlagged, since).
		Count(&count).Error
	return count, err
}
