package model

import (
	"strings"

	"github.com/QuantumNous/new-api/common"

	"github.com/samber/lo"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// proxyImportBatchSize 限制单次批量写入的条目数，避免超长 SQL。
const proxyImportBatchSize = 200

// Proxy 是代理池中的一条出站代理，供启用动态代理的渠道在请求时随机选择。
type Proxy struct {
	// Id 主键，自增 ID。
	Id int `json:"id" gorm:"primaryKey;autoIncrement"`
	// Url 完整代理地址，形如 scheme://[user:password@]host:port，scheme 仅允许
	// http、https、socks5、socks5h；该字段含凭据，接口只返回脱敏形式。
	Url string `json:"url" gorm:"type:varchar(512);not null"`
	// UrlHash 规范化 Url 的 SHA-256 十六进制摘要，用于导入去重和唯一约束。
	UrlHash string `json:"-" gorm:"type:varchar(64);uniqueIndex"`
	// Enabled 是否参与动态代理的随机选择；由代码显式赋值，不依赖数据库默认值。
	Enabled bool `json:"enabled"`
	// LatencyMs 最近一次连通性检测的耗时（毫秒），0 表示未检测或检测失败。
	LatencyMs int `json:"latency_ms"`
	// ExitIp 最近一次连通性检测观测到的出口 IP，空字符串表示未检测或检测失败。
	ExitIp string `json:"exit_ip" gorm:"type:varchar(64)"`
	// LastCheckTime 最近一次连通性检测的 Unix 秒时间戳，0 表示从未检测。
	LastCheckTime int64 `json:"last_check_time" gorm:"bigint"`
	// LastCheckOk 最近一次连通性检测是否成功。
	LastCheckOk bool `json:"last_check_ok"`
	// LastError 最近一次检测失败的原因（已脱敏，不含代理凭据），成功时为空。
	LastError string `json:"last_error" gorm:"type:varchar(512)"`
	// CreatedTime 创建时间（Unix 秒）。
	CreatedTime int64 `json:"created_time" gorm:"bigint"`
	// UpdatedTime 最近一次更新时间（Unix 秒）。
	UpdatedTime int64 `json:"updated_time" gorm:"bigint"`
}

// ProxyPoolEntry 是代理池快照所需的字段子集，避免热路径加载完整记录。
type ProxyPoolEntry struct {
	Id     int    `gorm:"column:id"`
	Url    string `gorm:"column:url"`
	ExitIp string `gorm:"column:exit_ip"`
}

// ProxyListFilter 描述代理池列表的查询条件。
type ProxyListFilter struct {
	Keyword string
	Enabled *bool
}

// GetProxyList 分页查询代理池条目；keyword 同时匹配地址与出口 IP。
func GetProxyList(pageInfo *common.PageInfo, filter ProxyListFilter) ([]Proxy, int64, error) {
	query := DB.Model(&Proxy{})
	if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		pattern, err := sanitizeLikePattern(keyword)
		if err != nil {
			return nil, 0, err
		}
		pattern = "%" + pattern + "%"
		query = query.Where("url LIKE ? ESCAPE '!' OR exit_ip LIKE ? ESCAPE '!'", pattern, pattern)
	}
	if filter.Enabled != nil {
		query = query.Where("enabled = ?", *filter.Enabled)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var proxies []Proxy
	err := query.Order("id DESC").
		Limit(pageInfo.GetPageSize()).
		Offset(pageInfo.GetStartIdx()).
		Find(&proxies).Error
	if err != nil {
		return nil, 0, err
	}
	return proxies, total, nil
}

// GetEnabledProxyPoolEntries 返回启用条目的池快照字段。
func GetEnabledProxyPoolEntries() ([]ProxyPoolEntry, error) {
	var entries []ProxyPoolEntry
	err := DB.Model(&Proxy{}).
		Select("id", "url", "exit_ip").
		Where("enabled = ?", true).
		Order("id ASC").
		Find(&entries).Error
	if err != nil {
		return nil, err
	}
	return entries, nil
}

// CountProxies 返回代理池的条目总数与启用数量。
func CountProxies() (total int64, enabled int64, err error) {
	if err = DB.Model(&Proxy{}).Count(&total).Error; err != nil {
		return 0, 0, err
	}
	if err = DB.Model(&Proxy{}).Where("enabled = ?", true).Count(&enabled).Error; err != nil {
		return 0, 0, err
	}
	return total, enabled, nil
}

// GetProxyById 按主键查询单条代理。
func GetProxyById(id int) (*Proxy, error) {
	var proxy Proxy
	err := DB.Where("id = ?", id).First(&proxy).Error
	if err != nil {
		return nil, err
	}
	return &proxy, nil
}

// GetProxiesByIds 按主键批量查询代理，返回顺序与 id 列表无关。
func GetProxiesByIds(ids []int) ([]Proxy, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var proxies []Proxy
	err := DB.Where("id IN ?", ids).Find(&proxies).Error
	if err != nil {
		return nil, err
	}
	return proxies, nil
}

// GetExistingProxyUrlHashes 返回给定摘要中已存在的部分，用于导入去重。
func GetExistingProxyUrlHashes(hashes []string) (map[string]struct{}, error) {
	existing := make(map[string]struct{}, len(hashes))
	if len(hashes) == 0 {
		return existing, nil
	}
	var found []string
	err := DB.Model(&Proxy{}).Where("url_hash IN ?", hashes).Pluck("url_hash", &found).Error
	if err != nil {
		return nil, err
	}
	for _, hash := range found {
		existing[hash] = struct{}{}
	}
	return existing, nil
}

func fillProxyTimestamps(proxy *Proxy) {
	now := common.GetTimestamp()
	if proxy.CreatedTime == 0 {
		proxy.CreatedTime = now
	}
	proxy.UpdatedTime = now
}

// CreateProxy 新增一条代理；地址摘要重复时返回 GORM 唯一约束错误。
func CreateProxy(proxy *Proxy) error {
	fillProxyTimestamps(proxy)
	return DB.Create(proxy).Error
}

// UpdateProxyFields 更新代理的可变字段，未提供的字段保持不变。
func UpdateProxyFields(id int, fields map[string]any) error {
	if len(fields) == 0 {
		return nil
	}
	fields["updated_time"] = common.GetTimestamp()
	return DB.Model(&Proxy{}).Where("id = ?", id).Updates(fields).Error
}

// SaveProxyCheckResult 写入一次连通性检测的结果。
func SaveProxyCheckResult(id int, latencyMs int, exitIp string, ok bool, lastError string) error {
	return UpdateProxyFields(id, map[string]any{
		"latency_ms":      latencyMs,
		"exit_ip":         exitIp,
		"last_check_ok":   ok,
		"last_error":      lastError,
		"last_check_time": common.GetTimestamp(),
	})
}

// DeleteProxy 删除单条代理。
func DeleteProxy(id int) error {
	return DB.Where("id = ?", id).Delete(&Proxy{}).Error
}

// DeleteProxies 批量删除指定代理。
func DeleteProxies(ids []int) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var deleted int64
	err := DB.Transaction(func(tx *gorm.DB) error {
		for _, chunk := range lo.Chunk(ids, proxyImportBatchSize) {
			result := tx.Where("id IN ?", chunk).Delete(&Proxy{})
			if result.Error != nil {
				return result.Error
			}
			deleted += result.RowsAffected
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return deleted, nil
}

// SetProxiesEnabled 批量启用或禁用代理。
func SetProxiesEnabled(ids []int, enabled bool) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var updated int64
	err := DB.Transaction(func(tx *gorm.DB) error {
		for _, chunk := range lo.Chunk(ids, proxyImportBatchSize) {
			result := tx.Model(&Proxy{}).Where("id IN ?", chunk).Updates(map[string]any{
				"enabled":      enabled,
				"updated_time": common.GetTimestamp(),
			})
			if result.Error != nil {
				return result.Error
			}
			updated += result.RowsAffected
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return updated, nil
}

// GetInvalidProxies 返回最近一次检测明确失败的代理；includeNeverChecked 为真时
// 连同从未检测过的条目一起返回。
func GetInvalidProxies(includeNeverChecked bool) ([]Proxy, error) {
	query := DB.Where("last_check_ok = ?", false)
	if !includeNeverChecked {
		query = query.Where("last_check_time > 0")
	}
	var proxies []Proxy
	if err := query.Find(&proxies).Error; err != nil {
		return nil, err
	}
	return proxies, nil
}

// ImportProxies 批量写入代理，已存在相同地址摘要的条目会被跳过；返回实际新增数量。
func ImportProxies(proxies []Proxy) (int, error) {
	if len(proxies) == 0 {
		return 0, nil
	}
	now := common.GetTimestamp()
	for i := range proxies {
		proxies[i].CreatedTime = now
		proxies[i].UpdatedTime = now
	}
	inserted := 0
	err := DB.Transaction(func(tx *gorm.DB) error {
		for _, chunk := range lo.Chunk(proxies, proxyImportBatchSize) {
			result := tx.Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "url_hash"}},
				DoNothing: true,
			}).Create(&chunk)
			if result.Error != nil {
				return result.Error
			}
			inserted += int(result.RowsAffected)
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return inserted, nil
}
