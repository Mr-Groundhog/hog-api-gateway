package model

import (
	"crypto/rand"
	"errors"
	"math/big"
	"strconv"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// RegistrationCode 注册码，用于在开启注册码校验后控制新用户注册。
// 与兑换码（Redemption）完全独立，使用单独的表存储。
type RegistrationCode struct {
	// Id 主键，自增 ID。
	Id int `json:"id" gorm:"primaryKey;autoIncrement"`
	// UserId 创建该注册码的管理员用户 ID。
	UserId int `json:"user_id"`
	// Key 注册码本体，随机 8 个字符（去掉易混淆字符的字母数字），唯一索引。
	Key string `json:"key" gorm:"type:varchar(8);uniqueIndex"`
	// Status 注册码状态：1 启用、2 禁用、3 已使用，复用 RedemptionCodeStatus* 常量语义。
	Status int `json:"status" gorm:"default:1"`
	// Name 注册码备注名，用于后台检索。
	Name string `json:"name" gorm:"index"`
	// CreatedTime 创建时间，Unix 秒级时间戳。
	CreatedTime int64 `json:"created_time" gorm:"bigint"`
	// UsedTime 被使用（绑定注册用户）的时间，Unix 秒级时间戳。
	UsedTime int64 `json:"used_time" gorm:"bigint"`
	// UsedUserId 绑定的注册用户 ID，0 表示尚未使用。
	UsedUserId int `json:"used_user_id"`
	// UsedUsername 绑定的注册用户名，便于后台直接查看，不随用户改名同步。
	UsedUsername string `json:"used_username" gorm:"type:varchar(64);not null;default:''"`
	// ExpiredTime 过期时间，Unix 秒级时间戳，0 表示不过期。
	ExpiredTime int64 `json:"expired_time" gorm:"bigint"`
	// Count 仅用于 API 请求的批量创建数量，不落库。
	Count int `json:"count" gorm:"-:all"`
	// DeletedAt 软删除时间。
	DeletedAt gorm.DeletedAt `gorm:"index"`
}

// registrationCodeAlphabet 注册码随机字符表，去掉了 0/O/1/I/l 等易混淆字符。
const registrationCodeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz"

// ErrRegistrationCodeGenerateFailed 生成随机注册码失败（熵源错误或冲突重试耗尽）。
var ErrRegistrationCodeGenerateFailed = errors.New("生成注册码失败")

// 注册码消费失败的哨兵错误，调用方据此返回对应的 i18n 提示。
var (
	ErrRegistrationCodeInvalid = errors.New("无效的注册码")
	ErrRegistrationCodeUsed    = errors.New("该注册码已被使用")
	ErrRegistrationCodeExpired = errors.New("该注册码已过期")
)

// generateRegistrationCodeKey 生成一个随机 8 字符注册码。
func generateRegistrationCodeKey() (string, error) {
	buf := make([]byte, 8)
	max := big.NewInt(int64(len(registrationCodeAlphabet)))
	for i := range buf {
		idx, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		buf[i] = registrationCodeAlphabet[idx.Int64()]
	}
	return string(buf), nil
}

// registrationCodeKeyCol 返回当前数据库方言下 key 列的引用形式（PG 用双引号）。
func registrationCodeKeyCol() string {
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		return `"key"`
	}
	return "`key`"
}

// GenerateUniqueRegistrationCodeKey 生成随机 8 字符注册码，并在撞到唯一索引时重试。
func GenerateUniqueRegistrationCodeKey() (string, error) {
	for i := 0; i < 5; i++ {
		key, err := generateRegistrationCodeKey()
		if err != nil {
			return "", err
		}
		var count int64
		if err := DB.Model(&RegistrationCode{}).Where(registrationCodeKeyCol()+" = ?", key).Count(&count).Error; err != nil {
			return "", err
		}
		if count == 0 {
			return key, nil
		}
	}
	return "", ErrRegistrationCodeGenerateFailed
}

func GetAllRegistrationCodes(startIdx int, num int) (codes []*RegistrationCode, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	err = tx.Model(&RegistrationCode{}).Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	err = tx.Order("id desc").Limit(num).Offset(startIdx).Find(&codes).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return codes, total, nil
}

func SearchRegistrationCodes(keyword string, status string, startIdx int, num int) (codes []*RegistrationCode, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := tx.Model(&RegistrationCode{})

	if keyword != "" {
		keyCol := registrationCodeKeyCol()
		if id, err := strconv.Atoi(keyword); err == nil {
			query = query.Where("id = ? OR name LIKE ? OR "+keyCol+" = ?", id, keyword+"%", keyword)
		} else {
			query = query.Where("name LIKE ? OR "+keyCol+" = ?", keyword+"%", keyword)
		}
	}

	if status != "" {
		now := common.GetTimestamp()
		switch status {
		case "expired":
			query = query.Where(
				"status = ? AND expired_time != 0 AND expired_time < ?",
				common.RedemptionCodeStatusEnabled,
				now,
			)
		case strconv.Itoa(common.RedemptionCodeStatusEnabled):
			query = query.Where(
				"status = ? AND (expired_time = 0 OR expired_time >= ?)",
				common.RedemptionCodeStatusEnabled,
				now,
			)
		case strconv.Itoa(common.RedemptionCodeStatusDisabled):
			query = query.Where("status = ?", common.RedemptionCodeStatusDisabled)
		case strconv.Itoa(common.RedemptionCodeStatusUsed):
			query = query.Where("status = ?", common.RedemptionCodeStatusUsed)
		}
	}

	err = query.Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	err = query.Order("id desc").Limit(num).Offset(startIdx).Find(&codes).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return codes, total, nil
}

func GetRegistrationCodeById(id int) (*RegistrationCode, error) {
	if id == 0 {
		return nil, errors.New("id 为空！")
	}
	code := RegistrationCode{Id: id}
	var err error = nil
	err = DB.First(&code, "id = ?", id).Error
	return &code, err
}

// ConsumeRegistrationCode 在注册流程中消费一个注册码：启用 -> 已使用，并记录绑定用户信息。
// 返回注册码 ID，供用户插入失败时补偿恢复。
func ConsumeRegistrationCode(key string, userId int, username string) (int, error) {
	if key == "" {
		return 0, errors.New("未提供注册码")
	}
	if userId == 0 {
		return 0, errors.New("无效的 user id")
	}
	code := &RegistrationCode{}

	keyCol := registrationCodeKeyCol()
	common.RandomSleep()
	err := DB.Transaction(func(tx *gorm.DB) error {
		err := lockForUpdate(tx).Where(keyCol+" = ?", key).First(code).Error
		if err != nil {
			return ErrRegistrationCodeInvalid
		}
		if code.Status != common.RedemptionCodeStatusEnabled {
			return ErrRegistrationCodeUsed
		}
		if code.ExpiredTime != 0 && code.ExpiredTime < common.GetTimestamp() {
			return ErrRegistrationCodeExpired
		}
		// Compare-and-swap on status: only the transaction that flips
		// enabled -> used wins, so concurrent registrations sharing the
		// same code lose here even without a row lock (e.g. on SQLite).
		result := tx.Model(&RegistrationCode{}).
			Where("id = ? AND status = ?", code.Id, common.RedemptionCodeStatusEnabled).
			Updates(map[string]interface{}{
				"used_time":     common.GetTimestamp(),
				"status":        common.RedemptionCodeStatusUsed,
				"used_user_id":  userId,
				"used_username": username,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrRegistrationCodeUsed
		}
		return nil
	})
	if err != nil {
		common.SysError("registration code consume failed: " + err.Error())
		return 0, err
	}
	return code.Id, nil
}

// RestoreRegistrationCode 注册流程中用户插入失败后的补偿：把刚消费的注册码恢复为启用状态。
func RestoreRegistrationCode(id int) {
	if id == 0 {
		return
	}
	result := DB.Model(&RegistrationCode{}).
		Where("id = ? AND status = ?", id, common.RedemptionCodeStatusUsed).
		Updates(map[string]interface{}{
			"status":        common.RedemptionCodeStatusEnabled,
			"used_time":     0,
			"used_user_id":  0,
			"used_username": "",
		})
	if result.Error != nil {
		common.SysError("failed to restore registration code: " + result.Error.Error())
	}
}

func (code *RegistrationCode) Insert() error {
	return DB.Create(code).Error
}

// Update 只更新 name/status/used_time/expired_time 字段。
func (code *RegistrationCode) Update() error {
	return DB.Model(code).Select("name", "status", "used_time", "expired_time").Updates(code).Error
}

func (code *RegistrationCode) Delete() error {
	return DB.Delete(code).Error
}

func DeleteRegistrationCodeById(id int) (err error) {
	if id == 0 {
		return errors.New("id 为空！")
	}
	code := RegistrationCode{Id: id}
	err = DB.Where(code).First(&code).Error
	if err != nil {
		return err
	}
	return code.Delete()
}

func DeleteInvalidRegistrationCodes() (int64, error) {
	now := common.GetTimestamp()
	result := DB.Where("status IN ? OR (status = ? AND expired_time != 0 AND expired_time < ?)", []int{common.RedemptionCodeStatusUsed, common.RedemptionCodeStatusDisabled}, common.RedemptionCodeStatusEnabled, now).Delete(&RegistrationCode{})
	return result.RowsAffected, result.Error
}

// CheckRegistrationCodeValid 校验注册码当前是否可用（存在、启用且未过期），不产生任何消费副作用。
// 返回 reason：invalid / used / expired，供前端展示具体原因。
func CheckRegistrationCodeValid(key string) (valid bool, reason string) {
	if key == "" {
		return false, "invalid"
	}
	code := &RegistrationCode{}
	keyCol := registrationCodeKeyCol()
	err := DB.Where(keyCol+" = ?", key).First(code).Error
	if err != nil {
		return false, "invalid"
	}
	switch {
	case code.Status == common.RedemptionCodeStatusUsed:
		return false, "used"
	case code.Status != common.RedemptionCodeStatusEnabled:
		return false, "used"
	case code.ExpiredTime != 0 && code.ExpiredTime < common.GetTimestamp():
		return false, "expired"
	default:
		return true, ""
	}
}
