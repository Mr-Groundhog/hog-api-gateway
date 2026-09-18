package model

import (
	"errors"
	"time"

	"gorm.io/gorm"
)

var ErrImageStudioDailyLimitReached = errors.New("image studio daily limit reached")

// ImageStudioDailyUsage records one user's successful image-studio generations for a business day.
type ImageStudioDailyUsage struct {
	// Id is the database primary key.
	Id int `json:"id" gorm:"primaryKey;autoIncrement"`
	// UserId identifies the user whose workbench generations are counted.
	UserId int `json:"user_id" gorm:"uniqueIndex:idx_image_studio_user_date;not null"`
	// UsageDate is the Asia/Shanghai calendar date in YYYY-MM-DD format.
	UsageDate string `json:"usage_date" gorm:"type:varchar(10);uniqueIndex:idx_image_studio_user_date;not null"`
	// Count is the number of successful workbench generation requests for the day.
	Count int `json:"count" gorm:"not null"`
	// UpdatedAt is the Unix timestamp of the latest reservation or rollback.
	UpdatedAt int64 `json:"updated_at" gorm:"index;not null"`
}

func imageStudioUsageDate(now time.Time) string {
	return now.In(shanghaiLocation).Format("2006-01-02")
}

func GetTodayImageStudioUsage(userId int) (int, error) {
	var usage ImageStudioDailyUsage
	err := DB.Where("user_id = ? AND usage_date = ?", userId, imageStudioUsageDate(time.Now())).First(&usage).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, nil
	}
	return usage.Count, err
}

func ReserveTodayImageStudioUsage(userId, limit int) (int, error) {
	if userId <= 0 {
		return 0, errors.New("invalid image studio user")
	}

	count := 0
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id").First(&user, userId).Error; err != nil {
			return err
		}

		usageDate := imageStudioUsageDate(time.Now())
		var usage ImageStudioDailyUsage
		err := lockForUpdate(tx).Where("user_id = ? AND usage_date = ?", userId, usageDate).First(&usage).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err == nil && limit > 0 && usage.Count >= limit {
			return ErrImageStudioDailyLimitReached
		}

		if errors.Is(err, gorm.ErrRecordNotFound) {
			usage = ImageStudioDailyUsage{UserId: userId, UsageDate: usageDate, Count: 1, UpdatedAt: time.Now().Unix()}
			if createErr := tx.Create(&usage).Error; createErr != nil {
				return createErr
			}
		} else {
			usage.Count++
			usage.UpdatedAt = time.Now().Unix()
			if saveErr := tx.Save(&usage).Error; saveErr != nil {
				return saveErr
			}
		}
		count = usage.Count
		return nil
	})
	return count, err
}

func ReleaseTodayImageStudioUsage(userId int) error {
	if userId <= 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id").First(&user, userId).Error; err != nil {
			return err
		}

		var usage ImageStudioDailyUsage
		err := lockForUpdate(tx).Where("user_id = ? AND usage_date = ?", userId, imageStudioUsageDate(time.Now())).First(&usage).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if usage.Count <= 1 {
			return tx.Delete(&usage).Error
		}
		return tx.Model(&usage).Updates(map[string]any{"count": usage.Count - 1, "updated_at": time.Now().Unix()}).Error
	})
}
