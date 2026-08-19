package model

import (
	"sort"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// UserIPRanking contains aggregated API activity and IP usage for one user.
type UserIPRanking struct {
	// UserId identifies the user that owns the API log records.
	UserId int `json:"user_id"`
	// Username is the username captured in the API log.
	Username string `json:"username"`
	// IpCount is the number of distinct non-empty IP addresses seen historically.
	IpCount int64 `json:"ip_count"`
	// Ips contains all distinct non-empty IP addresses seen historically.
	Ips []string `json:"ips"`
	// RecentIpCount is the number of distinct IP addresses seen in the last minute.
	RecentIpCount int64 `json:"recent_ip_count"`
	// TodayApiCalls is the number of API consume logs created today.
	TodayApiCalls int64 `json:"today_api_calls"`
}

type userIPRankingAggregate struct {
	UserId   int    `gorm:"column:user_id"`
	Username string `gorm:"column:username"`
	IpCount  int64  `gorm:"column:ip_count"`
}

type userIPRankingCount struct {
	UserId int   `gorm:"column:user_id"`
	Count  int64 `gorm:"column:count"`
}

type userIPRankingIP struct {
	UserId int    `gorm:"column:user_id"`
	Ip     string `gorm:"column:ip"`
}

// GetUserIPRankings aggregates API log IP activity and applies stable pagination.
func GetUserIPRankings(startIdx, pageSize int) (rankings []UserIPRanking, total int64, err error) {
	if startIdx < 0 {
		startIdx = 0
	}
	if pageSize <= 0 {
		pageSize = common.ItemsPerPage
	}

	consumeLogs := LOG_DB.Model(&Log{}).Where("type = ? AND user_id > ?", LogTypeConsume, 0)
	base := consumeLogs.Where("ip <> ?", "")
	err = consumeLogs.Select("COUNT(DISTINCT user_id)").Scan(&total).Error
	if err != nil {
		return nil, 0, err
	}

	var aggregates []userIPRankingAggregate
	err = consumeLogs.Select("user_id, MAX(username) AS username, COUNT(DISTINCT NULLIF(ip, '')) AS ip_count").
		Group("user_id").Order("ip_count DESC, user_id ASC").Limit(pageSize).Offset(startIdx).Find(&aggregates).Error
	if err != nil {
		return nil, 0, err
	}
	if len(aggregates) == 0 {
		return []UserIPRanking{}, total, nil
	}
	userIds := make([]int, 0, len(aggregates))
	for _, item := range aggregates {
		userIds = append(userIds, item.UserId)
	}

	var ips []userIPRankingIP
	err = base.Select("user_id, ip").Where("user_id IN ?", userIds).Distinct().Find(&ips).Error
	if err != nil {
		return nil, 0, err
	}
	ipMap := make(map[int][]string)
	for _, item := range ips {
		ipMap[item.UserId] = append(ipMap[item.UserId], item.Ip)
	}

	now := time.Now()
	var recent []userIPRankingCount
	err = base.Select("user_id, COUNT(DISTINCT ip) AS count").
		Where("user_id IN ? AND created_at >= ?", userIds, now.Add(-time.Minute).Unix()).
		Group("user_id").Find(&recent).Error
	if err != nil {
		return nil, 0, err
	}
	recentMap := make(map[int]int64, len(recent))
	for _, item := range recent {
		recentMap[item.UserId] = item.Count
	}

	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	var today []userIPRankingCount
	err = consumeLogs.Select("user_id, COUNT(*) AS count").
		Where("user_id IN ? AND created_at >= ?", userIds, startOfDay).
		Group("user_id").Find(&today).Error
	if err != nil {
		return nil, 0, err
	}
	todayMap := make(map[int]int64, len(today))
	for _, item := range today {
		todayMap[item.UserId] = item.Count
	}

	rankings = make([]UserIPRanking, 0, len(aggregates))
	for _, item := range aggregates {
		userIps := ipMap[item.UserId]
		sort.Strings(userIps)
		rankings = append(rankings, UserIPRanking{
			UserId:         item.UserId,
			Username:       item.Username,
			IpCount:        int64(len(userIps)),
			Ips:            userIps,
			RecentIpCount:  recentMap[item.UserId],
			TodayApiCalls:  todayMap[item.UserId],
		})
	}
	return rankings, total, nil
}
