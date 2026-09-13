package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// 合作申请审核状态。取值沿用「非零即业务状态」的约定（与工单状态一致），
// 升序即「待审核 → 已通过 → 已驳回」，可直接用于排序。
const (
	CooperationStatusPending  = 1 // 待审核：用户已提交，等待管理员处理
	CooperationStatusApproved = 2 // 已通过：管理员审核通过，合作关系成立
	CooperationStatusRejected = 3 // 已驳回：管理员驳回，用户可修正后重新申请
)

var (
	ErrCooperationNotFound      = errors.New("合作申请不存在")
	ErrCooperationPendingLimit  = errors.New("您已有一条待审核的合作申请，请等待管理员处理后再提交")
	ErrCooperationDailyLimit    = errors.New("今日提交的合作申请数已达上限，请明天再试")
	ErrCooperationNotPending    = errors.New("该申请当前不是待审核状态，无法执行此操作")
	ErrCooperationStatusInvalid = errors.New("无效的审核结果")
)

// CooperationApplication 记录一次用户提交的站点合作与推广申请及其审核结果。
// 用户在「合作推广」页面填写自己站点的信息与合作方式提交申请，管理员在
// 合作推广管理页审核（通过 / 驳回，附审核备注）。审核只记录结论，不自动
// 变更用户额度或分组。表名：cooperation_applications
type CooperationApplication struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`                                     // 主键，自增 ID
	UserId      int    `json:"user_id" gorm:"not null;index:idx_cooperation_user_created"`             // 申请人用户 ID，与 CreatedTime 组成联合索引用于「我的申请」列表与每日提交数统计
	Username    string `json:"username" gorm:"type:varchar(64);not null;default:''"`                   // 申请时的用户名快照，用户改名或注销后管理端列表仍可读
	SiteName    string `json:"site_name" gorm:"type:varchar(191);not null"`                            // 站点名称，业务上限 50 个字符（按 Unicode 码点计），列宽留余量以容纳 4 字节字符
	SiteUrl     string `json:"site_url" gorm:"type:varchar(255);not null"`                             // 站点地址，必须是 http(s) URL，业务上限 200 个字符（按 Unicode 码点计）
	SiteBanner  string `json:"site_banner" gorm:"type:varchar(255);not null;default:''"`               // 网站封面图 URL，可选，必须是 http(s) 图片链接，业务上限 200 个字符（按 Unicode 码点计）
	SiteType    string `json:"site_type" gorm:"type:varchar(32);not null"`                             // 站点类型标识，取 service 层白名单之一（blog / forum / tool / channel / team / open_source / other）
	Description string `json:"description" gorm:"type:text;not null"`                                  // 站点简介，业务上限 500 个字符（按 Unicode 码点计）
	Audience    string `json:"audience" gorm:"type:varchar(191);not null"`                             // 受众规模描述（如日活、粉丝量），业务上限 100 个字符（按 Unicode 码点计）
	Methods     string `json:"methods" gorm:"type:varchar(200);not null"`                              // 合作方式标识的 JSON 数组字符串（如 ["token","invite"]），元素取 service 层白名单，至少一项
	Contact     string `json:"contact" gorm:"type:varchar(191);not null"`                              // 联系方式（邮箱 / Telegram / QQ 等），业务上限 100 个字符（按 Unicode 码点计）
	Notes       string `json:"notes" gorm:"type:text"`                                                 // 补充说明，可空，业务上限 500 个字符（按 Unicode 码点计）
	Status      int    `json:"status" gorm:"not null;index"`                                           // 审核状态，取 CooperationStatus*；升序即「待审核 → 已通过 → 已驳回」，可直接用于排序
	ReviewNote  string `json:"review_note" gorm:"type:varchar(512);not null;default:''"`               // 管理员审核备注（通过理由或驳回原因），随审核结果展示给申请人
	ReviewerId  int    `json:"reviewer_id" gorm:"not null;default:0"`                                  // 执行审核的管理员用户 ID，未审核时为 0
	ReviewTime  int64  `json:"review_time" gorm:"bigint;not null;default:0"`                           // 审核完成时间（Unix 秒），未审核时为 0
	CreatedTime int64  `json:"created_time" gorm:"bigint;not null;index:idx_cooperation_user_created"` // 申请提交时间（Unix 秒）
	UpdatedTime int64  `json:"updated_time" gorm:"bigint;not null"`                                    // 记录最后变更时间（Unix 秒）
}

func (CooperationApplication) TableName() string {
	return "cooperation_applications"
}

// CreateCooperationApplication 在单个事务内新建一条待审核申请。与工单创建一致，
// 事务内先锁住申请人的 users 行把同一用户的提交串行化，再检查「同时仅一条
// 待审核」与当日提交数上限——不锁用户行时，双击或多端并发提交会让多个请求
// 都读到「未达上限」然后各插一条，绕过限制。SQLite 跳过行锁，但其单写者模型
// 天然串行，同样安全。dayStart 是当日零点（Unix 秒），由调用方按服务器本地
// 时区计算。
func CreateCooperationApplication(app *CooperationApplication, maxPendingPerUser int, maxPerUserPerDay int, dayStart int64, now int64) error {
	if app.UserId <= 0 {
		return ErrCooperationNotFound
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		user := &User{}
		if err := lockForUpdate(tx).First(user, "id = ?", app.UserId).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrCooperationNotFound
			}
			return err
		}

		var pendingCount int64
		if err := tx.Model(&CooperationApplication{}).
			Where("user_id = ? AND status = ?", app.UserId, CooperationStatusPending).
			Count(&pendingCount).Error; err != nil {
			return err
		}
		if pendingCount >= int64(maxPendingPerUser) {
			return ErrCooperationPendingLimit
		}

		var dailyCount int64
		if err := tx.Model(&CooperationApplication{}).
			Where("user_id = ? AND created_time >= ?", app.UserId, dayStart).
			Count(&dailyCount).Error; err != nil {
			return err
		}
		if dailyCount >= int64(maxPerUserPerDay) {
			return ErrCooperationDailyLimit
		}

		app.Status = CooperationStatusPending
		app.ReviewNote = ""
		app.ReviewerId = 0
		app.ReviewTime = 0
		app.CreatedTime = now
		app.UpdatedTime = now
		return tx.Create(app).Error
	})
}

// GetCooperationApplicationsByUserId 返回用户自己的全部申请，按 ID 倒序。
// 单用户申请量受每日上限约束（驳回后可重交），不需要分页。
func GetCooperationApplicationsByUserId(userId int) ([]*CooperationApplication, error) {
	var apps []*CooperationApplication
	err := DB.Where("user_id = ?", userId).Order("id DESC").Find(&apps).Error
	return apps, err
}

// GetCooperationApplicationById 按主键读取一条申请。
func GetCooperationApplicationById(id int) (*CooperationApplication, error) {
	if id <= 0 {
		return nil, ErrCooperationNotFound
	}
	app := &CooperationApplication{}
	err := DB.First(app, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrCooperationNotFound
	}
	if err != nil {
		return nil, err
	}
	return app, nil
}

// CooperationListFilter 是管理端申请列表的查询条件。零值字段表示该条件不生效。
type CooperationListFilter struct {
	Status  int    // 按审核状态过滤，0 表示不过滤
	UserId  int    // 精确匹配申请人用户 ID，0 表示不过滤
	Keyword string // 模糊匹配站点名称或用户名快照（管理端）
}

// GetCooperationApplications 分页查询管理端申请列表，按 ID 倒序。
func GetCooperationApplications(filter CooperationListFilter, pageInfo *common.PageInfo) ([]*CooperationApplication, int64, error) {
	query := DB.Model(&CooperationApplication{})
	if filter.Status != 0 {
		query = query.Where("status = ?", filter.Status)
	}
	if filter.UserId > 0 {
		query = query.Where("user_id = ?", filter.UserId)
	}
	if filter.Keyword != "" {
		keyword := "%" + filter.Keyword + "%"
		query = query.Where("site_name LIKE ? OR username LIKE ?", keyword, keyword)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var apps []*CooperationApplication
	err := query.Order("id DESC").
		Limit(pageInfo.GetPageSize()).
		Offset(pageInfo.GetStartIdx()).
		Find(&apps).Error
	return apps, total, err
}

// ReviewCooperationApplication 管理员审核一条待审核申请：通过或驳回，附审核
// 备注。条件更新（WHERE status = pending）而非行锁，并发重复审核只生效一次，
// SQLite 上同样竞态安全；状态、备注、审核人与时间在同一事务内写入。通过时
// 还会在同一事务内把申请的站点信息同步为一条合作站点条目，保证「申请已通过
// 但站点未上架」不会因中途失败出现。
func ReviewCooperationApplication(id int, reviewerId int, targetStatus int, reviewNote string, now int64) (*CooperationApplication, error) {
	if id <= 0 {
		return nil, ErrCooperationNotFound
	}
	if targetStatus != CooperationStatusApproved && targetStatus != CooperationStatusRejected {
		return nil, ErrCooperationStatusInvalid
	}
	app := &CooperationApplication{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&CooperationApplication{}).
			Where("id = ? AND status = ?", id, CooperationStatusPending).
			Updates(map[string]any{
				"status":       targetStatus,
				"review_note":  reviewNote,
				"reviewer_id":  reviewerId,
				"review_time":  now,
				"updated_time": now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrCooperationNotPending
		}
		if err := tx.First(app, "id = ?", id).Error; err != nil {
			return err
		}
		if targetStatus == CooperationStatusApproved {
			return createCooperationSiteFromApplication(tx, app, now)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return app, nil
}

// DeleteCooperationApplicationById 删除一条申请记录（管理端）。删除不存在的
// 记录按不存在报错，不静默成功。
func DeleteCooperationApplicationById(id int) error {
	if id <= 0 {
		return ErrCooperationNotFound
	}
	result := DB.Where("id = ?", id).Delete(&CooperationApplication{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrCooperationNotFound
	}
	return nil
}

// GetCooperationStatusCounts 按审核状态统计申请数，用于管理端概览与侧边栏
// 待审红点。键为 CooperationStatus*，无记录的状态不出现在返回的 map 中。
func GetCooperationStatusCounts() (map[int]int64, error) {
	rows := []struct {
		Status int
		Total  int64
	}{}
	if err := DB.Model(&CooperationApplication{}).
		Select("status, COUNT(*) as total").
		Group("status").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	counts := make(map[int]int64, len(rows))
	for _, row := range rows {
		counts[row.Status] = row.Total
	}
	return counts, nil
}
