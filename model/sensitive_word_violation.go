package model

import (
	"time"

	"gorm.io/gorm"
)

// SensitiveWordHighlightThreshold is the cumulative trigger count that marks a user for administrator review.
const SensitiveWordHighlightThreshold = 5

// SensitiveWordViolation records a blocked prompt and the sensitive words it matched.
type SensitiveWordViolation struct {
	// Id is the database primary key.
	Id int `json:"id" gorm:"primaryKey;autoIncrement"`
	// UserId identifies the user who submitted the blocked request; zero means unauthenticated.
	UserId int `json:"user_id" gorm:"index"`
	// Username stores the username snapshot for stable administrator reporting.
	Username string `json:"username" gorm:"type:varchar(64);index"`
	// Ip stores the client IP address observed by the gateway.
	Ip string `json:"ip" gorm:"type:varchar(64);index"`
	// UserAgent stores the client user-agent header.
	UserAgent string `json:"user_agent" gorm:"type:varchar(512)"`
	// RequestPath stores the API path that received the blocked request.
	RequestPath string `json:"request_path" gorm:"type:varchar(255)"`
	// RequestContent stores the normalized prompt content that was checked.
	RequestContent string `json:"request_content" gorm:"type:text"`
	// MatchedWords stores the matched sensitive words as a JSON array.
	MatchedWords string `json:"matched_words" gorm:"type:text"`
	// MatchLocations stores matched word locations as a JSON array of character offsets.
	MatchLocations string `json:"match_locations" gorm:"type:text"`
	// TriggerCount is the user's cumulative trigger count at this event.
	TriggerCount int `json:"trigger_count" gorm:"index"`
	// Highlighted marks records at or above the administrator review threshold.
	Highlighted bool `json:"highlighted" gorm:"index"`
	// CreatedAt stores the event timestamp as Unix seconds.
	CreatedAt int64 `json:"created_at" gorm:"index"`
}

// CountSensitiveWordViolations returns the total number of violations for a user.
func CountSensitiveWordViolations(userId int) (int64, error) {
	var count int64
	err := DB.Model(&SensitiveWordViolation{}).Where("user_id = ?", userId).Count(&count).Error
	return count, err
}

// IncrementSensitiveWordTriggerCount atomically increments and returns a user's cumulative trigger count.
func IncrementSensitiveWordTriggerCount(userId int) (int, error) {
	if userId <= 0 {
		return 0, nil
	}
	err := DB.Model(&User{}).Where("id = ?", userId).
		UpdateColumn("sensitive_word_trigger_count", gorm.Expr("sensitive_word_trigger_count + ?", 1)).Error
	if err != nil {
		return 0, err
	}
	var count int
	err = DB.Model(&User{}).Where("id = ?", userId).Select("sensitive_word_trigger_count").Scan(&count).Error
	return count, err
}

// ResetSensitiveWordTriggerCount clears a user's cumulative count and historical review markers.
func ResetSensitiveWordTriggerCount(userId int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&User{}).Where("id = ?", userId).
			UpdateColumn("sensitive_word_trigger_count", 0).Error; err != nil {
			return err
		}
		return tx.Model(&SensitiveWordViolation{}).Where("user_id = ?", userId).Updates(map[string]interface{}{
			"trigger_count": 0,
			"highlighted":   false,
		}).Error
	})
}

// RecordSensitiveWordViolation persists a blocked request and its review metadata.
func RecordSensitiveWordViolation(violation *SensitiveWordViolation) error {
	if violation.CreatedAt == 0 {
		violation.CreatedAt = time.Now().Unix()
	}
	return DB.Create(violation).Error
}
