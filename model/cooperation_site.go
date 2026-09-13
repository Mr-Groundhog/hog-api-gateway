package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

var (
	ErrCooperationSiteNotFound = errors.New("合作站点不存在")
)

// MaxCooperationSiteEntryDescriptionRunes 合作站点条目简介的字符数上限（Unicode
// 码点）。service 层的条目校验与申请通过时简介截断共用这一个值，保证「手工
// 创建」与「审批自动同步」两条路径的约束一致。
const MaxCooperationSiteEntryDescriptionRunes = 200

// createCooperationSiteFromApplication 在审核通过的同一事务内，把申请携带的
// 站点信息同步为一条对外展示的合作站点条目（默认启用、非重点、排序 0）。
// 已存在相同地址的条目（含停用）时跳过，避免重复申请或重新审批产生重复展示；
// 申请简介允许 500 字而条目上限 200 字，超出部分按 Unicode 码点截断。
func createCooperationSiteFromApplication(tx *gorm.DB, app *CooperationApplication, now int64) error {
	var existing int64
	if err := tx.Model(&CooperationSite{}).
		Where("url = ?", app.SiteUrl).
		Count(&existing).Error; err != nil {
		return err
	}
	if existing > 0 {
		return nil
	}
	description := []rune(app.Description)
	if len(description) > MaxCooperationSiteEntryDescriptionRunes {
		description = description[:MaxCooperationSiteEntryDescriptionRunes]
	}
	site := &CooperationSite{
		Name:        app.SiteName,
		Url:         app.SiteUrl,
		Banner:      app.SiteBanner,
		SiteType:    app.SiteType,
		Description: string(description),
		Enabled:     true,
		CreatedTime: now,
		UpdatedTime: now,
	}
	return tx.Create(site).Error
}

// CooperationSite 是管理端维护的合作站点展示条目，驱动「合作站点」公共页面：
// 全部以卡片形式展示，重点（Featured）站点优先排在前面。
// 表名：cooperation_sites
type CooperationSite struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`                                      // 主键，自增 ID
	Name        string `json:"name" gorm:"type:varchar(191);not null"`                                  // 站点名称，业务上限 50 个字符（按 Unicode 码点计），列宽留余量以容纳 4 字节字符
	Url         string `json:"url" gorm:"type:varchar(255);not null"`                                   // 站点链接，必须是 http(s) URL，业务上限 200 个字符（按 Unicode 码点计）
	Logo        string `json:"logo" gorm:"type:varchar(255);not null;default:''"`                       // 站点 Logo 图片链接（可选），业务上限 200 个字符；卡片无 Logo 时以名称首字回退
	Banner      string `json:"banner" gorm:"type:varchar(255);not null;default:''"`                     // 封面图图片链接（可选），业务上限 200 个字符；展示在站点卡片顶部，无图时不渲染封面区
	SiteType    string `json:"site_type" gorm:"type:varchar(32);not null;default:''"`                   // 站点类型标识，取 service 层白名单之一（blog / forum / tool / channel / team / open_source / relay / other）；空串表示未设置，卡片不展示类型标签
	Description string `json:"description" gorm:"type:varchar(500);not null;default:''"`                // 站点简介，业务上限 200 个字符（按 Unicode 码点计）
	Featured    bool   `json:"featured" gorm:"index:idx_cooperation_site_featured_sort"`                // 是否重点合作站点：在合作站点页面优先于普通站点展示
	Sort        int    `json:"sort" gorm:"not null;default:0;index:idx_cooperation_site_featured_sort"` // 展示排序权重，序号越小越靠前；同序号按 ID 升序
	Enabled     bool   `json:"enabled" gorm:"index"`                                                    // 是否对外展示；业务默认值由代码归一化（新建默认 true），不用列默认值以避免跨库 boolean 默认差异
	CreatedTime int64  `json:"created_time" gorm:"bigint;not null"`                                     // 创建时间（Unix 秒）
	UpdatedTime int64  `json:"updated_time" gorm:"bigint;not null"`                                     // 最后变更时间（Unix 秒）
}

func (CooperationSite) TableName() string {
	return "cooperation_sites"
}

// GetEnabledCooperationSites 返回对外展示的合作站点，按「序号升序 → ID 升序」
// 排序，序号越小越靠前。公共页面按 Featured 字段自行划分轮播区与卡片区。
func GetEnabledCooperationSites() ([]*CooperationSite, error) {
	var sites []*CooperationSite
	err := DB.Where("enabled = ?", true).
		Order("sort ASC, id ASC").
		Find(&sites).Error
	return sites, err
}

// GetAllCooperationSites 返回全部合作站点（含停用），管理端列表用，
// 排序与公共页面一致，方便管理员预览展示顺序。
func GetAllCooperationSites() ([]*CooperationSite, error) {
	var sites []*CooperationSite
	err := DB.Order("sort ASC, id ASC").Find(&sites).Error
	return sites, err
}

// GetCooperationSiteById 按主键读取一条合作站点。
func GetCooperationSiteById(id int) (*CooperationSite, error) {
	if id <= 0 {
		return nil, ErrCooperationSiteNotFound
	}
	site := &CooperationSite{}
	err := DB.First(site, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrCooperationSiteNotFound
	}
	if err != nil {
		return nil, err
	}
	return site, nil
}

// CreateCooperationSite 新建一条合作站点记录。
func CreateCooperationSite(site *CooperationSite) error {
	now := common.GetTimestamp()
	site.CreatedTime = now
	site.UpdatedTime = now
	return DB.Create(site).Error
}

// UpdateCooperationSite 按主键整体更新一条合作站点；站点不存在时返回
// ErrCooperationSiteNotFound，不静默成功。
func UpdateCooperationSite(site *CooperationSite) error {
	if site.Id <= 0 {
		return ErrCooperationSiteNotFound
	}
	result := DB.Model(&CooperationSite{}).
		Where("id = ?", site.Id).
		Updates(map[string]any{
			"name":         site.Name,
			"url":          site.Url,
			"logo":         site.Logo,
			"banner":       site.Banner,
			"site_type":    site.SiteType,
			"description":  site.Description,
			"featured":     site.Featured,
			"sort":         site.Sort,
			"enabled":      site.Enabled,
			"updated_time": common.GetTimestamp(),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrCooperationSiteNotFound
	}
	return nil
}

// DeleteCooperationSiteById 删除一条合作站点记录；不存在时返回
// ErrCooperationSiteNotFound。
func DeleteCooperationSiteById(id int) error {
	if id <= 0 {
		return ErrCooperationSiteNotFound
	}
	result := DB.Where("id = ?", id).Delete(&CooperationSite{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrCooperationSiteNotFound
	}
	return nil
}
