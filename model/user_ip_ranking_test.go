package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGetUserIPRankingsAggregatesAndSortsUsers(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Log{}))
	previousLogDB := LOG_DB
	previousLogType := common.LogDatabaseType()
	LOG_DB = db
	common.SetLogDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		LOG_DB = previousLogDB
		common.SetLogDatabaseType(previousLogType)
	})

	now := time.Now().Unix()
	logs := []Log{
		{UserId: 1, Username: "alice", Type: LogTypeConsume, Ip: "10.0.0.1", CreatedAt: now - 2*24*60*60},
		{UserId: 1, Username: "alice", Type: LogTypeConsume, Ip: "10.0.0.2", CreatedAt: now - 30},
		{UserId: 1, Username: "alice", Type: LogTypeConsume, Ip: "10.0.0.1", CreatedAt: now - 20},
		{UserId: 1, Username: "alice", Type: LogTypeConsume, Ip: "", CreatedAt: now - 10},
		{UserId: 2, Username: "bob", Type: LogTypeConsume, Ip: "10.0.0.3", CreatedAt: now - 2*24*60*60},
		{UserId: 2, Username: "bob", Type: LogTypeConsume, Ip: "", CreatedAt: now - 2*24*60*60},
		{UserId: 3, Username: "carol", Type: LogTypeError, Ip: "10.0.0.4", CreatedAt: 1},
		{UserId: 4, Username: "dave", Type: LogTypeConsume, Ip: "", CreatedAt: now - 10},
	}
	require.NoError(t, db.Create(&logs).Error)

	items, total, err := GetUserIPRankings(0, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(3), total)
	require.Len(t, items, 3)
	assert.Equal(t, 1, items[0].UserId)
	assert.Equal(t, int64(2), items[0].IpCount)
	assert.Equal(t, []string{"10.0.0.1", "10.0.0.2"}, items[0].Ips)
	assert.Equal(t, int64(1), items[0].RecentIpCount)
	assert.Equal(t, int64(2), items[0].TodayApiCalls)
	assert.Equal(t, 2, items[1].UserId)
	assert.Equal(t, int64(1), items[1].IpCount)
	assert.Equal(t, int64(0), items[1].TodayApiCalls)
	assert.Equal(t, 4, items[2].UserId)
	assert.Empty(t, items[2].Ips)
	assert.NotNil(t, items[2].Ips)
	payload, err := common.Marshal(items[2])
	require.NoError(t, err)
	assert.Contains(t, string(payload), `"ips":[]`)
}
