package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/alicebob/miniredis/v2"
	"github.com/glebarez/sqlite"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func resetProbeGuardMemoryStore() {
	probeGuardMemory = &probeGuardMemoryStore{users: map[int]*probeGuardMemoryUser{}}
}

func useProbeGuardMiniRedis(t *testing.T) *miniredis.Miniredis {
	t.Helper()

	previousEnabled := common.RedisEnabled
	previousClient := common.RDB
	redisServer := miniredis.RunT(t)
	redisClient := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	require.NoError(t, redisClient.Ping(context.Background()).Err())

	common.RedisEnabled = true
	common.RDB = redisClient
	t.Cleanup(func() {
		_ = redisClient.Close()
		common.RedisEnabled = previousEnabled
		common.RDB = previousClient
	})
	return redisServer
}

func setupProbeGuardTestDB(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.Token{}, &model.ProbeGuardLog{}))
	model.DB = db
	t.Cleanup(func() {
		model.DB = previousDB
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})
}

func TestProbeGuardMemoryWindowCountsDistinctModels(t *testing.T) {
	resetProbeGuardMemoryStore()

	models, err := RecordProbeGuardModel(1, "gpt-4o", 30)
	require.NoError(t, err)
	assert.Equal(t, []string{"gpt-4o"}, models)

	models, err = RecordProbeGuardModel(1, "gpt-4o", 30)
	require.NoError(t, err)
	assert.Len(t, models, 1)

	models, err = RecordProbeGuardModel(1, "claude-3-5-sonnet", 30)
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"gpt-4o", "claude-3-5-sonnet"}, models)

	// 不同用户互不共享窗口
	models, err = RecordProbeGuardModel(2, "gemini-2.0-flash", 30)
	require.NoError(t, err)
	assert.Equal(t, []string{"gemini-2.0-flash"}, models)
}

func TestProbeGuardMemoryWindowPrunesExpiredSamples(t *testing.T) {
	resetProbeGuardMemoryStore()

	windowSeconds := int64(30)
	oldTs := time.Now().Unix() - windowSeconds - 1
	probeGuardMemory.users[7] = &probeGuardMemoryUser{
		samples: []probeGuardMemorySample{
			{ts: oldTs, model: "old-model-1"},
			{ts: oldTs, model: "old-model-2"},
		},
	}

	models, err := RecordProbeGuardModel(7, "fresh-model", 30)
	require.NoError(t, err)
	assert.Equal(t, []string{"fresh-model"}, models)
	assert.Len(t, probeGuardMemory.users[7].samples, 1)
}

func TestProbeGuardMemoryCooldownClaimMergesSameWindow(t *testing.T) {
	resetProbeGuardMemoryStore()

	assert.True(t, ClaimProbeGuardTrigger(9, 30), "首次触发应抢占成功")
	assert.False(t, ClaimProbeGuardTrigger(9, 30), "冷却期内再次触发应被合并")

	probeGuardMemory.users[9].lastTriggerAt = time.Now().Unix() - 31
	assert.True(t, ClaimProbeGuardTrigger(9, 30), "冷却期结束后应允许新的触发")
}

func TestDistinctModelsFromMembersHandlesModelNamesWithColons(t *testing.T) {
	members := []string{
		fmt.Sprintf("%d:%s", time.Now().UnixNano(), "gemini-2.0-flash"),
		fmt.Sprintf("%d:%s", time.Now().UnixNano(), "models/gemini-1.5-pro:generateContent"),
		fmt.Sprintf("%d:%s", time.Now().UnixNano(), "gemini-2.0-flash"),
		"invalid-member",
	}
	models := distinctModelsFromMembers(members)
	assert.ElementsMatch(t, []string{"gemini-2.0-flash", "models/gemini-1.5-pro:generateContent"}, models)
}

func TestProbeGuardRedisWindowAndCooldown(t *testing.T) {
	redisServer := useProbeGuardMiniRedis(t)

	models, err := RecordProbeGuardModel(11, "gpt-4o", 30)
	require.NoError(t, err)
	assert.Equal(t, []string{"gpt-4o"}, models)

	for _, name := range []string{"claude-3-5-sonnet", "gemini-2.0-flash", "gpt-4o"} {
		_, err := RecordProbeGuardModel(11, name, 30)
		require.NoError(t, err)
	}
	models, err = RecordProbeGuardModel(11, "deepseek-chat", 30)
	require.NoError(t, err)
	assert.ElementsMatch(t,
		[]string{"gpt-4o", "claude-3-5-sonnet", "gemini-2.0-flash", "deepseek-chat"}, models)

	windowKey := fmt.Sprintf("%s:models:%d", probeGuardRedisKeyPrefix, 11)
	assert.True(t, redisServer.Exists(windowKey), "窗口 key 应写入 Redis")
	assert.True(t, redisServer.TTL(windowKey) > 0, "窗口 key 应设置 TTL")

	assert.True(t, ClaimProbeGuardTrigger(11, 30))
	assert.False(t, ClaimProbeGuardTrigger(11, 30))
	cooldownKey := fmt.Sprintf("%s:cooldown:%d", probeGuardRedisKeyPrefix, 11)
	assert.True(t, redisServer.Exists(cooldownKey))
}

func TestIncrementProbeGuardTriggerCount(t *testing.T) {
	setupProbeGuardTestDB(t)
	user := &model.User{Username: "probe_user", Password: "12345678", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
	require.NoError(t, model.DB.Create(user).Error)

	count, err := model.IncrementProbeGuardTriggerCount(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	count, err = model.IncrementProbeGuardTriggerCount(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 2, count)

	require.NoError(t, model.ResetProbeGuardTriggerCount(user.Id))
	count, err = model.IncrementProbeGuardTriggerCount(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 1, count)
}

func TestBanUserForProbeGuardDisablesUserAndClearsCaches(t *testing.T) {
	setupProbeGuardTestDB(t)
	user := &model.User{
		Username: "banned_probe_user", Password: "12345678",
		Role: common.RoleCommonUser, Status: common.UserStatusEnabled,
	}
	require.NoError(t, model.DB.Create(user).Error)

	require.NoError(t, BanUserForProbeGuard(user.Id))

	var updated model.User
	require.NoError(t, model.DB.Where("id = ?", user.Id).First(&updated).Error)
	assert.Equal(t, common.UserStatusDisabled, updated.Status)
	assert.Equal(t, model.UserBanReasonBatchModelProbing, updated.BanReason)
}
