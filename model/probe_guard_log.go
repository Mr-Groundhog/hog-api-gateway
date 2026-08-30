package model

import (
	"time"

	"gorm.io/gorm"
)

// ProbeGuardActionTaken 标识一次测活违规触发后的处置动作。
const (
	// ProbeGuardActionWarning 表示本次触发未达到封禁阈值，仅返回警告。
	ProbeGuardActionWarning = "warning"
	// ProbeGuardActionBanned 表示本次触发达到了封禁阈值，用户已被自动封禁。
	ProbeGuardActionBanned = "banned"
	// ProbeGuardActionDryRun 表示观察模式下只记录、不拦截不封禁。
	ProbeGuardActionDryRun = "dry_run"
)

// ProbeGuardLog records one cross-model probe guard trigger event (not one request).
type ProbeGuardLog struct {
	// Id is the database primary key.
	Id int `json:"id" gorm:"primaryKey;autoIncrement"`
	// UserId identifies the user who triggered the probe guard event.
	UserId int `json:"user_id" gorm:"index"`
	// Username stores the username snapshot for stable administrator reporting.
	Username string `json:"username" gorm:"type:varchar(64);index"`
	// TokenId identifies the token used by the triggering request.
	TokenId int `json:"token_id"`
	// TokenName stores the token name snapshot used by the triggering request.
	TokenName string `json:"token_name" gorm:"type:varchar(128)"`
	// Ip stores the client IP address observed by the gateway.
	Ip string `json:"ip" gorm:"type:varchar(64);index"`
	// UserAgent stores the client user-agent header.
	UserAgent string `json:"user_agent" gorm:"type:varchar(512)"`
	// WindowSeconds stores the sliding window length (seconds) configured at trigger time.
	WindowSeconds int `json:"window_seconds"`
	// ModelsTested stores the distinct models observed in the window as a JSON array.
	ModelsTested string `json:"models_tested" gorm:"type:text"`
	// DistinctCount stores the number of distinct models in the window at trigger time.
	DistinctCount int `json:"distinct_count"`
	// TriggerCount is the user's cumulative probe guard trigger count at this event.
	TriggerCount int `json:"trigger_count" gorm:"index"`
	// ActionTaken records the disposition: warning, banned, or dry_run.
	ActionTaken string `json:"action_taken" gorm:"type:varchar(16);index"`
	// CreatedAt stores the event timestamp as Unix seconds.
	CreatedAt int64 `json:"created_at" gorm:"index"`
}

// IncrementProbeGuardTriggerCount atomically increments and returns a user's cumulative probe guard trigger count.
func IncrementProbeGuardTriggerCount(userId int) (int, error) {
	if userId <= 0 {
		return 0, nil
	}
	err := DB.Model(&User{}).Where("id = ?", userId).
		UpdateColumn("probe_guard_trigger_count", gorm.Expr("probe_guard_trigger_count + ?", 1)).Error
	if err != nil {
		return 0, err
	}
	var count int
	err = DB.Model(&User{}).Where("id = ?", userId).Select("probe_guard_trigger_count").Scan(&count).Error
	return count, err
}

// ResetProbeGuardTriggerCount clears a user's cumulative probe guard trigger count and the
// trigger-count snapshots on their historical records. The administrator list aggregates
// MAX(trigger_count) over probe_guard_logs, so leaving the snapshots untouched would keep the
// old count (and its risk badge) on screen after a reset. Both writes run in one transaction.
func ResetProbeGuardTriggerCount(userId int) error {
	if userId <= 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&User{}).Where("id = ?", userId).
			UpdateColumn("probe_guard_trigger_count", 0).Error; err != nil {
			return err
		}
		return tx.Model(&ProbeGuardLog{}).Where("user_id = ?", userId).
			UpdateColumn("trigger_count", 0).Error
	})
}

// RecordProbeGuardLog persists one probe guard trigger event.
func RecordProbeGuardLog(entry *ProbeGuardLog) error {
	if entry.CreatedAt == 0 {
		entry.CreatedAt = time.Now().Unix()
	}
	return DB.Create(entry).Error
}
