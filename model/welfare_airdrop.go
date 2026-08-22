package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"gorm.io/gorm"
)

// 福利空投活动状态。沿用兑换码「1 启用 / 2 停用」的取值习惯，避免 0 值歧义。
const (
	WelfareAirdropStatusEnabled  = 1
	WelfareAirdropStatusDisabled = 2
)

// WelfareAirdropUnlimitedStock 表示活动不限量：TotalCount 为 0 时库存不做上限校验。
const WelfareAirdropUnlimitedStock = 0

var (
	ErrWelfareAirdropNotFound      = errors.New("福利空投活动不存在")
	ErrWelfareAirdropDisabled      = errors.New("该福利空投活动已停用")
	ErrWelfareAirdropNotStarted    = errors.New("该福利空投活动尚未开始")
	ErrWelfareAirdropEnded         = errors.New("该福利空投活动已结束")
	ErrWelfareAirdropSoldOut       = errors.New("该福利空投已被领完")
	ErrWelfareAirdropUserLimit     = errors.New("您已达到该福利空投的领取上限")
	ErrWelfareAirdropQuotaOverflow = errors.New("您的额度已接近上限，无法发放本次福利，请先消耗部分额度后再试")
	// ErrWelfareAirdropStatusInvalid 表示管理端提交了未知的活动状态值。
	ErrWelfareAirdropStatusInvalid = errors.New("无效的活动状态")
)

// WelfareAirdrop 描述一场限时福利空投活动。领取时会为用户签发一张真实的兑换码
// （redemptions 表记录，直接标记为已使用），因此空投是兑换码体系的扩展而非旁路，
// 管理员在兑换码列表中依然可以完整追溯每一笔发放。
// 表名：welfare_airdrops
type WelfareAirdrop struct {
	Id           int    `json:"id" gorm:"primaryKey;autoIncrement"`                                         // 主键，自增 ID
	Name         string `json:"name" gorm:"type:varchar(64);not null"`                                      // 活动名称，展示在空投卡片标题并作为签发兑换码的名称
	Description  string `json:"description" gorm:"type:varchar(255);not null;default:''"`                   // 活动说明，展示在卡片正文，可为空字符串
	Quota        int    `json:"quota" gorm:"not null"`                                                      // 单次领取发放的额度（内部额度单位），必须为正数且不超过 common.MaxQuota
	TotalCount   int    `json:"total_count" gorm:"not null;default:0"`                                      // 活动总库存份数，0 表示不限量（WelfareAirdropUnlimitedStock）
	ClaimedCount int    `json:"claimed_count" gorm:"not null;default:0"`                                    // 已被领取的份数，由领取事务原子自增，不可手工回退
	PerUserLimit int    `json:"per_user_limit" gorm:"not null;default:1"`                                   // 每个用户在本活动中可领取的次数上限，最小为 1
	StartTime    int64  `json:"start_time" gorm:"bigint;not null;default:0"`                                // 活动开始时间（Unix 秒），0 表示立即开始
	EndTime      int64  `json:"end_time" gorm:"bigint;not null;default:0"`                                  // 活动结束时间（Unix 秒），0 表示不设截止；限时活动由该字段驱动倒计时
	Status       int    `json:"status" gorm:"not null;index:idx_welfare_airdrop_status_sort"`               // 活动状态，取 WelfareAirdropStatusEnabled / WelfareAirdropStatusDisabled
	SortOrder    int    `json:"sort_order" gorm:"not null;default:0;index:idx_welfare_airdrop_status_sort"` // 展示顺序，数值小的排在前面，相同则按 ID 倒序
	CreatorId    int    `json:"creator_id" gorm:"not null;default:0"`                                       // 创建该活动的管理员用户 ID，同时作为签发兑换码的归属人
	// AirdropGroup 限定可见和可领取该活动的用户分组，空字符串表示所有分组。
	AirdropGroup string `json:"airdrop_group" gorm:"type:varchar(64);not null;default:'';index:idx_welfare_airdrop_group"`
	// BatchId 标识本次活动对应的兑换码批次，创建后保持不变以便库存归集和审计。
	BatchId     string `json:"batch_id" gorm:"type:varchar(64);not null;index"`
	CreatedTime int64  `json:"created_time" gorm:"bigint;not null"` // 活动创建时间（Unix 秒）
	UpdatedTime int64  `json:"updated_time" gorm:"bigint;not null"` // 活动最后一次变更时间（Unix 秒），领取导致库存变化时也会刷新
}

func (WelfareAirdrop) TableName() string {
	return "welfare_airdrops"
}

// WelfareAirdropClaim 记录一次成功的福利空投领取，用于按用户限次、对账以及在
// 前端展示领取历史与对应兑换码。
// 表名：welfare_airdrop_claims
type WelfareAirdropClaim struct {
	Id            int    `json:"id" gorm:"primaryKey;autoIncrement"`                                                                  // 主键，自增 ID
	AirdropId     int    `json:"airdrop_id" gorm:"not null;uniqueIndex:ux_welfare_claim_airdrop_user"`                                // 被领取的活动 ID（对应 welfare_airdrops 主键），与 UserId 组成联合唯一约束
	UserId        int    `json:"user_id" gorm:"not null;uniqueIndex:ux_welfare_claim_airdrop_user;index:idx_welfare_claim_user_time"` // 领取用户 ID
	RedemptionId  int    `json:"redemption_id" gorm:"not null;index"`                                                                 // 本次领取签发的兑换码 ID（对应 redemptions 主键）
	RedemptionKey string `json:"redemption_key" gorm:"type:char(32);not null"`                                                        // 本次领取签发的兑换码明文，供用户在领取记录中查看与复制
	AirdropName   string `json:"airdrop_name" gorm:"type:varchar(64);not null"`                                                       // 领取时的活动名称快照，活动改名或删除后记录仍可读
	Quota         int    `json:"quota" gorm:"not null"`                                                                               // 本次实际发放的额度快照
	CreatedTime   int64  `json:"created_time" gorm:"bigint;not null;index:idx_welfare_claim_user_time"`                               // 领取时间（Unix 秒），与 UserId 组成联合索引用于按时间倒序查询
}

func (WelfareAirdropClaim) TableName() string {
	return "welfare_airdrop_claims"
}

// Claimable 判断活动在给定时刻是否处于可领取窗口内，并返回不可领取的原因。
func (airdrop *WelfareAirdrop) Claimable(now int64) error {
	if airdrop.Status != WelfareAirdropStatusEnabled {
		return ErrWelfareAirdropDisabled
	}
	if airdrop.StartTime != 0 && now < airdrop.StartTime {
		return ErrWelfareAirdropNotStarted
	}
	if airdrop.EndTime != 0 && now > airdrop.EndTime {
		return ErrWelfareAirdropEnded
	}
	if airdrop.TotalCount != WelfareAirdropUnlimitedStock && airdrop.ClaimedCount >= airdrop.TotalCount {
		return ErrWelfareAirdropSoldOut
	}
	return nil
}

// GetWelfareAirdropById 按主键读取一场活动。
func GetWelfareAirdropById(id int) (*WelfareAirdrop, error) {
	if id <= 0 {
		return nil, ErrWelfareAirdropNotFound
	}
	airdrop := &WelfareAirdrop{}
	err := DB.First(airdrop, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrWelfareAirdropNotFound
	}
	if err != nil {
		return nil, err
	}
	return airdrop, nil
}

// GetWelfareAirdropByBatchId 按兑换码批次读取对应活动。
func GetWelfareAirdropByBatchId(batchId string) (*WelfareAirdrop, error) {
	if batchId == "" {
		return nil, ErrWelfareAirdropNotFound
	}
	var airdrop WelfareAirdrop
	if err := DB.Where("batch_id = ?", batchId).First(&airdrop).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrWelfareAirdropNotFound
		}
		return nil, err
	}
	return &airdrop, nil
}

// GetActiveWelfareAirdrops 返回所有启用中且未过期的活动，供普通用户的空投页展示。
// 尚未开始的活动也会返回，前端据此展示「即将开始」的倒计时。
func GetActiveWelfareAirdrops(now int64) ([]*WelfareAirdrop, error) {
	var airdrops []*WelfareAirdrop
	err := DB.
		Where("status = ? AND (end_time = 0 OR end_time >= ?)", WelfareAirdropStatusEnabled, now).
		Order("sort_order ASC, id DESC").
		Find(&airdrops).Error
	return airdrops, err
}

// GetAllWelfareAirdrops 返回全部活动（含停用与已结束），供管理端维护列表。
func GetAllWelfareAirdrops() ([]*WelfareAirdrop, error) {
	var airdrops []*WelfareAirdrop
	err := DB.Order("sort_order ASC, id DESC").Find(&airdrops).Error
	return airdrops, err
}

// CountUserWelfareAirdropClaims 统计某用户在指定活动下已成功领取的次数。
func CountUserWelfareAirdropClaims(airdropId int, userId int) (int64, error) {
	var count int64
	err := DB.Model(&WelfareAirdropClaim{}).
		Where("airdrop_id = ? AND user_id = ?", airdropId, userId).
		Count(&count).Error
	return count, err
}

// CountUserWelfareAirdropClaimsByAirdrop 一次性统计某用户在给定活动集合下各自的
// 已领取次数，避免空投列表按活动逐条查询。返回的 map 以活动 ID 为键。
func CountUserWelfareAirdropClaimsByAirdrop(userId int, airdropIds []int) (map[int]int, error) {
	result := make(map[int]int, len(airdropIds))
	if userId <= 0 || len(airdropIds) == 0 {
		return result, nil
	}

	var rows []struct {
		AirdropId int
		Total     int
	}
	err := DB.Model(&WelfareAirdropClaim{}).
		Select("airdrop_id, COUNT(*) AS total").
		Where("user_id = ? AND airdrop_id IN ?", userId, airdropIds).
		Group("airdrop_id").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.AirdropId] = row.Total
	}
	return result, nil
}

// GetUserWelfareAirdropClaims 返回某用户按时间倒序的领取记录，limit 限制条数。
func GetUserWelfareAirdropClaims(userId int, limit int) ([]*WelfareAirdropClaim, error) {
	var claims []*WelfareAirdropClaim
	err := DB.Where("user_id = ?", userId).
		Order("created_time DESC, id DESC").
		Limit(limit).
		Find(&claims).Error
	return claims, err
}

// ClaimWelfareAirdrop 在单个事务内完成一次领取：校验活动窗口与用户限次、原子扣减
// 库存、签发一张已使用的兑换码、写入领取记录并给用户加额度。任一步骤失败都会回滚，
// 因此不会出现「记录已写但额度未到账」或「库存已扣但兑换码缺失」的中间态。
//
// 库存扣减使用条件更新（WHERE 带上库存与状态判断）而非依赖行锁，这样在 SQLite
// （不支持 SELECT ... FOR UPDATE）上同样是竞态安全的。
func ClaimWelfareAirdrop(airdropId int, userId int, now int64) (*WelfareAirdropClaim, error) {
	if userId <= 0 {
		return nil, errors.New("无效的 user id")
	}

	claim := &WelfareAirdropClaim{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		airdrop := &WelfareAirdrop{}
		err := lockForUpdate(tx).First(airdrop, "id = ?", airdropId).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrWelfareAirdropNotFound
		}
		if err != nil {
			return err
		}
		if err := airdrop.Claimable(now); err != nil {
			return err
		}
		if airdrop.Quota <= 0 || airdrop.Quota > common.MaxQuota {
			return ErrWelfareAirdropDisabled
		}

		var claimed int64
		if err := tx.Model(&WelfareAirdropClaim{}).
			Where("airdrop_id = ? AND user_id = ?", airdropId, userId).
			Count(&claimed).Error; err != nil {
			return err
		}
		if claimed >= 1 {
			return ErrWelfareAirdropUserLimit
		}

		redemption := &Redemption{}
		redemptionQuery := lockForUpdate(tx).
			Where("is_airdrop = ? AND airdrop_batch_id = ? AND status = ?", true, airdrop.BatchId, common.RedemptionCodeStatusEnabled).
			Where("valid_until = 0 OR valid_until >= ?", now).
			Order("id ASC")
		if err := redemptionQuery.First(redemption).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrWelfareAirdropSoldOut
			}
			return err
		}
		if redemption.Quota <= 0 || redemption.Quota > common.MaxQuota {
			return ErrWelfareAirdropDisabled
		}

		// 原子占用一份库存：不限量活动只校验状态，限量活动额外要求剩余库存为正。
		stockUpdate := tx.Model(&WelfareAirdrop{}).
			Where("id = ? AND status = ?", airdropId, WelfareAirdropStatusEnabled)
		if airdrop.TotalCount != WelfareAirdropUnlimitedStock {
			stockUpdate = stockUpdate.Where("claimed_count < total_count")
		}
		stockResult := stockUpdate.Updates(map[string]interface{}{
			"claimed_count": gorm.Expr("claimed_count + ?", 1),
			"updated_time":  now,
		})
		if stockResult.Error != nil {
			return stockResult.Error
		}
		if stockResult.RowsAffected != 1 {
			return ErrWelfareAirdropSoldOut
		}

		redemptionResult := tx.Model(&Redemption{}).
			Where("id = ? AND status = ?", redemption.Id, common.RedemptionCodeStatusEnabled).
			Updates(map[string]interface{}{
				"status":        common.RedemptionCodeStatusUsed,
				"used_user_id":  userId,
				"redeemed_time": now,
			})
		if redemptionResult.Error != nil {
			return redemptionResult.Error
		}
		if redemptionResult.RowsAffected != 1 {
			return ErrWelfareAirdropSoldOut
		}

		claim.AirdropId = airdropId
		claim.UserId = userId
		claim.RedemptionId = redemption.Id
		claim.RedemptionKey = redemption.Key
		claim.AirdropName = airdrop.Name
		claim.Quota = redemption.Quota
		claim.CreatedTime = now
		if err := tx.Create(claim).Error; err != nil {
			return err
		}

		// 条件加额度：WHERE 同时保证用户仍存在，且加完不会越过 int32 额度列上限。
		// common.MaxQuota-airdrop.Quota 不会下溢，因为上面已校验 Quota <= MaxQuota。
		quotaResult := tx.Model(&User{}).
			Where("id = ? AND quota <= ?", userId, common.MaxQuota-redemption.Quota).
			Update("quota", gorm.Expr("quota + ?", redemption.Quota))
		if quotaResult.Error != nil {
			return quotaResult.Error
		}
		if quotaResult.RowsAffected != 1 {
			return ErrWelfareAirdropQuotaOverflow
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// 数据库变更已提交，此时才同步额度缓存，缓存失败不影响已落库的领取结果。
	syncCreditUserQuotaCache(userId, claim.Quota, "welfare airdrop")
	RecordLog(userId, LogTypeTopup, fmt.Sprintf("通过福利空投「%s」获得 %s，兑换码ID %d", claim.AirdropName, logger.LogQuota(claim.Quota), claim.RedemptionId))
	return claim, nil
}

// SyncWelfareAirdropStockForBatch 在管理员创建空投兑换码时维护对应的活动记录：
// 批次已存在活动则把新增码数累加进库存（必要时延长截止时间），否则创建一场新活动。
// 用户端空投页只展示 welfare_airdrops 表中的活动，缺了这步用户将永远看不到可领取的空投。
func SyncWelfareAirdropStockForBatch(batchId string, name string, quota int, count int, validUntil int64, creatorId int, now int64) error {
	if batchId == "" || quota <= 0 || count <= 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var campaign WelfareAirdrop
		err := tx.Where("batch_id = ?", batchId).First(&campaign).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			campaign = WelfareAirdrop{
				Name:         name,
				Quota:        quota,
				TotalCount:   count,
				PerUserLimit: 1,
				StartTime:    0,
				EndTime:      validUntil,
				Status:       WelfareAirdropStatusEnabled,
				BatchId:      batchId,
				CreatorId:    creatorId,
				CreatedTime:  now,
				UpdatedTime:  now,
			}
			if err := tx.Create(&campaign).Error; err != nil {
				return err
			}
			// batch_id 无唯一索引，两个管理员并发向同一批次发码时可能同时走到创建分支，
			// 各建一场活动（用户即可领取两次）。创建后复查：若批次下已存在更早的活动，
			// 撤销本次创建并把库存并入最早的那一场。
			var oldest WelfareAirdrop
			if err := tx.Where("batch_id = ?", batchId).Order("id ASC").First(&oldest).Error; err != nil {
				return err
			}
			if oldest.Id != campaign.Id {
				if err := tx.Delete(&WelfareAirdrop{}, campaign.Id).Error; err != nil {
					return err
				}
				return tx.Model(&WelfareAirdrop{}).Where("id = ?", oldest.Id).Updates(map[string]interface{}{
					"total_count":  gorm.Expr("total_count + ?", count),
					"updated_time": now,
				}).Error
			}
			return nil
		}
		if err != nil {
			return err
		}
		updates := map[string]interface{}{
			"total_count":  gorm.Expr("total_count + ?", count),
			"updated_time": now,
		}
		if validUntil > campaign.EndTime {
			updates["end_time"] = validUntil
		}
		return tx.Model(&WelfareAirdrop{}).Where("id = ?", campaign.Id).Updates(updates).Error
	})
}

// AdjustWelfareAirdropStockForBatch 在空投兑换码离开/回到可领取池（删除、停用、
// 重新启用）时对批次活动的库存做对应增减，保证「剩余可领取数」与实际可用码数
// 一致，避免用户端看到幽灵库存。减库存时带 total_count >= 1 条件防止减成负数。
func AdjustWelfareAirdropStockForBatch(batchId string, delta int, now int64) error {
	if batchId == "" || delta == 0 {
		return nil
	}
	update := DB.Model(&WelfareAirdrop{}).Where("batch_id = ?", batchId)
	if delta < 0 {
		update = update.Where("total_count >= ?", -delta)
	}
	return update.Updates(map[string]interface{}{
		"total_count":  gorm.Expr("total_count + ?", delta),
		"updated_time": now,
	}).Error
}

// ExpiredUnusedAirdropBatchCounts 统计各批次下「已过期但从未被使用」的空投兑换码
// 数量，供清理无效兑换码前释放对应的幽灵库存。
func ExpiredUnusedAirdropBatchCounts(now int64) (map[string]int, error) {
	var rows []struct {
		AirdropBatchId string
		Total          int
	}
	err := DB.Model(&Redemption{}).
		Select("airdrop_batch_id, COUNT(*) AS total").
		Where("is_airdrop = ? AND status = ? AND expired_time != 0 AND expired_time < ?",
			true, common.RedemptionCodeStatusEnabled, now).
		Group("airdrop_batch_id").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[string]int, len(rows))
	for _, row := range rows {
		result[row.AirdropBatchId] = row.Total
	}
	return result, nil
}

// UpdateWelfareAirdropStatus 只切换活动状态，不触碰其余字段，供管理端
// 「取消/恢复空投」使用，避免全量更新误清空活动配置。
// 联动规则：停用活动时批量停用该批次所有未使用的空投码，启用时一并恢复，
// 保证用户无法通过任何路径领到已取消活动的码。
func UpdateWelfareAirdropStatus(id int, status int, now int64) error {
	if status != WelfareAirdropStatusEnabled && status != WelfareAirdropStatusDisabled {
		return ErrWelfareAirdropStatusInvalid
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		campaign := &WelfareAirdrop{}
		if err := tx.First(campaign, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrWelfareAirdropNotFound
			}
			return err
		}
		if err := tx.Model(&WelfareAirdrop{}).
			Where("id = ?", id).
			Updates(map[string]interface{}{
				"status":       status,
				"updated_time": now,
			}).Error; err != nil {
			return err
		}

		// 停用：把批次内启用中的码全部停用；启用：把批次内被停用的码恢复启用。
		// 已被使用（used）的码状态不同，两个方向都不会被误改。注意启用会把
		// 管理员此前单独停用的码一并恢复，需保持单独停用的请不要启用活动。
		var fromStatus, toStatus int
		if status == WelfareAirdropStatusEnabled {
			fromStatus, toStatus = common.RedemptionCodeStatusDisabled, common.RedemptionCodeStatusEnabled
		} else {
			fromStatus, toStatus = common.RedemptionCodeStatusEnabled, common.RedemptionCodeStatusDisabled
		}
		return tx.Model(&Redemption{}).
			Where("is_airdrop = ? AND airdrop_batch_id = ? AND status = ?",
				true, campaign.BatchId, fromStatus).
			Update("status", toStatus).Error
	})
}

// InsertWelfareAirdrop 新建一场活动。
func (airdrop *WelfareAirdrop) Insert() error {
	return DB.Create(airdrop).Error
}

// Update 保存活动的可编辑字段。ClaimedCount 由领取事务独占维护，这里刻意不写入，
// 避免管理员保存表单时把并发领取产生的库存变化覆盖回旧值。
func (airdrop *WelfareAirdrop) Update() error {
	return DB.Model(airdrop).
		Select("name", "description", "quota", "total_count", "per_user_limit",
			"start_time", "end_time", "status", "sort_order", "airdrop_group", "updated_time").
		Updates(airdrop).Error
}

// DeleteWelfareAirdropById 删除一场活动，并联动删除该批次所有未被使用的空投码，
// 避免残留的码在兑换码列表里成为孤儿数据。领取记录与已被使用的兑换码保持不变，
// 以便历史发放仍可对账。
func DeleteWelfareAirdropById(id int) error {
	if id <= 0 {
		return ErrWelfareAirdropNotFound
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		campaign := &WelfareAirdrop{}
		if err := tx.First(campaign, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrWelfareAirdropNotFound
			}
			return err
		}
		if err := tx.Where(
			"is_airdrop = ? AND airdrop_batch_id = ? AND status != ?",
			true, campaign.BatchId, common.RedemptionCodeStatusUsed,
		).Delete(&Redemption{}).Error; err != nil {
			return err
		}
		return tx.Delete(&WelfareAirdrop{}, id).Error
	})
}
