package model

import (
	"time"

	_ "time/tzdata" // 内嵌 IANA 时区数据库，保证 Asia/Shanghai 在精简容器中也可用
)

// shanghaiLocation 缓存上海时区，避免每次调用重复加载。
var shanghaiLocation = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		// 理论上不会走到这里（已内嵌 tzdata），降级为本地时区避免panic。
		return time.Local
	}
	return loc
}()

// UserRedemptionLog 记录每次成功兑换额度码的行为，用于限制每个用户每天的兑换次数。
// 表名：user_redemption_logs
type UserRedemptionLog struct {
	Id           int    `json:"id" gorm:"primaryKey;autoIncrement"`                                        // 主键，自增 ID
	UserId       int    `json:"user_id" gorm:"index:idx_user_redemption_date;not null"`                    // 兑换用户 ID，与 RedeemDate 组成联合索引用于按天统计
	RedemptionId int    `json:"redemption_id" gorm:"index;not null"`                                       // 被兑换的额度码 ID（对应 redemptions 表主键）
	RedeemDate   string `json:"redeem_date" gorm:"type:varchar(10);index:idx_user_redemption_date;not null"` // 兑换日期，格式 YYYY-MM-DD，按天限制兑换次数的依据
	CreatedAt    int64  `json:"created_at" gorm:"index;not null"`                                         // 兑换发生的时间戳（Unix 秒），用于审计与排序
}

func (UserRedemptionLog) TableName() string {
	return "user_redemption_logs"
}

// redemptionDate 返回按"每日 08:00（上海时间）重置"口径计算的兑换日。
// 以 Asia/Shanghai 时区的当天 08:00 为分界：08:00 之前归属前一天，08:00 及之后归属当天。
// 统计与记录必须共用此口径，否则会出现判断与落库不一致。
func redemptionDate(t time.Time) string {
	now := t.In(shanghaiLocation)
	if now.Hour() < 8 {
		now = now.AddDate(0, 0, -1)
	}
	return now.Format("2006-01-02")
}

// TodayRedemptionCount 返回指定用户当天（以上海时间 08:00 为日界）的成功兑换次数。
func TodayRedemptionCount(userId int) (int64, error) {
	today := redemptionDate(time.Now())
	var count int64
	err := DB.Model(&UserRedemptionLog{}).
		Where("user_id = ? AND redeem_date = ?", userId, today).
		Count(&count).Error
	return count, err
}

// RecordRedemption 记录一次成功兑换，便于后续按天对用户做次数限制。
// RedeemDate 与 TodayRedemptionCount 使用同一日界（上海时间 08:00 重置）。
func RecordRedemption(userId int, redemptionId int) error {
	log := &UserRedemptionLog{
		UserId:       userId,
		RedemptionId: redemptionId,
		RedeemDate:   redemptionDate(time.Now()),
		CreatedAt:    time.Now().Unix(),
	}
	return DB.Create(log).Error
}
