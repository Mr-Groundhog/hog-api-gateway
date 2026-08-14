package model

import (
	"time"
)

// UserRedemptionLog 记录每次成功兑换额度码的行为，用于限制每个用户每天的兑换次数。
type UserRedemptionLog struct {
	Id           int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId       int    `json:"user_id" gorm:"index:idx_user_redemption_date;not null"`
	RedemptionId int    `json:"redemption_id" gorm:"index;not null"`
	RedeemDate   string `json:"redeem_date" gorm:"type:varchar(10);index:idx_user_redemption_date;not null"` // 格式: YYYY-MM-DD
	CreatedAt    int64  `json:"created_at" gorm:"index;not null"`
}

func (UserRedemptionLog) TableName() string {
	return "user_redemption_logs"
}

// TodayRedemptionCount 返回指定用户当天的成功兑换次数。
func TodayRedemptionCount(userId int) (int64, error) {
	today := time.Now().Format("2006-01-02")
	var count int64
	err := DB.Model(&UserRedemptionLog{}).
		Where("user_id = ? AND redeem_date = ?", userId, today).
		Count(&count).Error
	return count, err
}

// RecordRedemption 记录一次成功兑换，便于后续按天对用户做次数限制。
func RecordRedemption(userId int, redemptionId int) error {
	log := &UserRedemptionLog{
		UserId:       userId,
		RedemptionId: redemptionId,
		RedeemDate:   time.Now().Format("2006-01-02"),
		CreatedAt:    time.Now().Unix(),
	}
	return DB.Create(log).Error
}
