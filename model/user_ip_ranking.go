package model

import (
	"sort"
	"time"
)

// UserIPRanking contains aggregated API activity and IP usage for one user.
type UserIPRanking struct {
	// UserId identifies the user that owns the API log records.
	UserId int `json:"user_id"`
	// Username is the username captured in the API log.
	Username string `json:"username"`
	// IpCount is the number of distinct non-empty IP addresses seen during the selected ranking period.
	IpCount int64 `json:"ip_count"`
	// Ips contains all distinct non-empty IP addresses seen during the selected ranking period.
	Ips []string `json:"ips"`
	// TenMinuteIpCount is the number of distinct IP addresses seen in the last 10 minutes.
	TenMinuteIpCount int64 `json:"ten_minute_ip_count"`
	// ApiCalls is the number of API consume logs created during the selected ranking period.
	ApiCalls int64 `json:"api_calls"`
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

// GetUserIPRankings aggregates API log IP activity within the selected period and returns the top 50 users.
func GetUserIPRankings(period string) (rankings []UserIPRanking, total int64, err error) {
	if period != "3days" {
		period = "today"
	}
	now := time.Now()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	periodStart := startOfDay
	if period == "3days" {
		periodStart = startOfDay.AddDate(0, 0, -2)
	}
	periodStartUnix := periodStart.Unix()

	var aggregates []userIPRankingAggregate
	err = LOG_DB.Model(&Log{}).
		Where("type = ? AND user_id > ? AND created_at >= ?", LogTypeConsume, 0, periodStartUnix).
		Select("user_id, MAX(username) AS username, COUNT(DISTINCT NULLIF(ip, '')) AS ip_count").
		Group("user_id").
		Order("COUNT(DISTINCT NULLIF(ip, '')) DESC").
		Order("user_id ASC").
		Limit(50).
		Find(&aggregates).Error
	if err != nil {
		return nil, 0, err
	}
	total = int64(len(aggregates))
	if len(aggregates) == 0 {
		return []UserIPRanking{}, total, nil
	}
	userIds := make([]int, 0, len(aggregates))
	for _, item := range aggregates {
		userIds = append(userIds, item.UserId)
	}

	var ips []userIPRankingIP
	err = LOG_DB.Model(&Log{}).
		Where("type = ? AND user_id > ? AND ip <> ? AND created_at >= ?", LogTypeConsume, 0, "", periodStartUnix).
		Where("user_id IN ?", userIds).
		Select("user_id, ip").
		Group("user_id, ip").
		Find(&ips).Error
	if err != nil {
		return nil, 0, err
	}
	ipMap := make(map[int][]string)
	for _, item := range ips {
		ipMap[item.UserId] = append(ipMap[item.UserId], item.Ip)
	}

	var recent []userIPRankingCount
	err = LOG_DB.Model(&Log{}).
		Where("type = ? AND user_id > ? AND ip <> ? AND created_at >= ?", LogTypeConsume, 0, "", periodStartUnix).
		Select("user_id, COUNT(DISTINCT ip) AS count").
		Where("user_id IN ? AND created_at >= ?", userIds, now.Add(-10*time.Minute).Unix()).
		Group("user_id").Find(&recent).Error
	if err != nil {
		return nil, 0, err
	}
	recentMap := make(map[int]int64, len(recent))
	for _, item := range recent {
		recentMap[item.UserId] = item.Count
	}

	var apiCalls []userIPRankingCount
	err = LOG_DB.Model(&Log{}).
		Where("type = ? AND user_id > ? AND created_at >= ?", LogTypeConsume, 0, periodStartUnix).
		Select("user_id, COUNT(*) AS count").
		Where("user_id IN ?", userIds).
		Group("user_id").Find(&apiCalls).Error
	if err != nil {
		return nil, 0, err
	}
	apiCallMap := make(map[int]int64, len(apiCalls))
	for _, item := range apiCalls {
		apiCallMap[item.UserId] = item.Count
	}

	rankings = make([]UserIPRanking, 0, len(aggregates))
	for _, item := range aggregates {
		userIps := ipMap[item.UserId]
		if userIps == nil {
			userIps = []string{}
		}
		sort.Strings(userIps)
		rankings = append(rankings, UserIPRanking{
			UserId:        item.UserId,
			Username:      item.Username,
			IpCount:       int64(len(userIps)),
			Ips:           userIps,
			TenMinuteIpCount: recentMap[item.UserId],
			ApiCalls:      apiCallMap[item.UserId],
		})
	}
	return rankings, total, nil
}
