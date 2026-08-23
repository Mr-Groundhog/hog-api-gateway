package service

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/go-redis/redis/v8"
	"gorm.io/gorm"
)

const probeGuardRedisKeyPrefix = "probeGuard"

// probeGuardMemoryMaxUsers bounds the in-memory fallback store; exceeding it
// triggers a sweep of users whose windows have fully expired.
const probeGuardMemoryMaxUsers = 100000

// RecordProbeGuardModel 将一次请求的目标模型写入用户的滑动窗口，
// 返回窗口内出现过的去重模型列表（顺序为首次出现顺序）。
func RecordProbeGuardModel(userId int, modelName string, windowSeconds int) ([]string, error) {
	if userId <= 0 || modelName == "" {
		return nil, nil
	}
	if common.RedisEnabled {
		return recordProbeGuardModelRedis(userId, modelName, windowSeconds)
	}
	return probeGuardMemory.record(userId, modelName, windowSeconds)
}

// ClaimProbeGuardTrigger 以窗口时长为冷却期抢占一次触发事件的权利。
// 返回 true 表示调用方是本冷却期内的第一个触发者，应记录事件并执行处置；
// 后续越界请求返回 false，只拦截不重复计数。
func ClaimProbeGuardTrigger(userId int, cooldownSeconds int) bool {
	if userId <= 0 {
		return false
	}
	if common.RedisEnabled {
		ctx := context.Background()
		key := fmt.Sprintf("%s:cooldown:%d", probeGuardRedisKeyPrefix, userId)
		ok, err := common.RDB.SetNX(ctx, key, "1", time.Duration(cooldownSeconds)*time.Second).Result()
		if err != nil {
			common.SysError(fmt.Sprintf("probe guard cooldown claim failed for user %d: %v", userId, err))
			return false
		}
		return ok
	}
	return probeGuardMemory.claimTrigger(userId, cooldownSeconds)
}

// BanUserForProbeGuard 禁用测活违规用户，并同步失效浏览器会话、令牌缓存与鉴权缓存，
// 使后续并发请求在鉴关卡即被拒绝。
func BanUserForProbeGuard(userId int) error {
	err := model.DB.Model(&model.User{}).Where("id = ?", userId).Updates(map[string]interface{}{
		"status":       common.UserStatusDisabled,
		"ban_reason":   model.UserBanReasonBatchModelProbing,
		"auth_version": gorm.Expr("auth_version + 1"),
	}).Error
	if err != nil {
		return err
	}
	_, _ = model.RevokeAllUserSessions(userId, "user_security_changed")
	_ = model.InvalidateUserTokensCache(userId)
	_ = model.PublishUserAuthCache(userId)
	return nil
}

// recordProbeGuardModelRedis 使用 ZSet 滑动窗口记录模型访问：
// member 为 "{unix_nano}:{model}"（模型名可含冒号，按第一个冒号切分），
// score 为 Unix 秒。清理、写入、续期、读取放在同一个事务管道中执行。
func recordProbeGuardModelRedis(userId int, modelName string, windowSeconds int) ([]string, error) {
	ctx := context.Background()
	key := fmt.Sprintf("%s:models:%d", probeGuardRedisKeyPrefix, userId)
	now := time.Now()
	member := fmt.Sprintf("%d:%s", now.UnixNano(), modelName)

	pipe := common.RDB.TxPipeline()
	pipe.ZRemRangeByScore(ctx, key, "-inf", fmt.Sprintf("(%d", now.Unix()-int64(windowSeconds)))
	pipe.ZAdd(ctx, key, &redis.Z{Score: float64(now.Unix()), Member: member})
	pipe.Expire(ctx, key, time.Duration(windowSeconds*2)*time.Second)
	pipe.ZRange(ctx, key, 0, -1)

	cmds, err := pipe.Exec(ctx)
	if err != nil && err != redis.Nil {
		return nil, err
	}
	if len(cmds) < 4 {
		return nil, fmt.Errorf("probe guard pipeline returned %d commands", len(cmds))
	}
	members, err := cmds[3].(*redis.StringSliceCmd).Result()
	if err != nil && err != redis.Nil {
		return nil, err
	}
	return distinctModelsFromMembers(members), nil
}

func distinctModelsFromMembers(members []string) []string {
	seen := make(map[string]struct{}, len(members))
	models := make([]string, 0, len(members))
	for _, member := range members {
		idx := strings.Index(member, ":")
		if idx < 0 {
			continue
		}
		name := member[idx+1:]
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		models = append(models, name)
	}
	return models
}

type probeGuardMemorySample struct {
	ts    int64  // Unix 秒
	model string // 请求的目标模型名
}

type probeGuardMemoryUser struct {
	samples       []probeGuardMemorySample // 窗口内样本，按时间升序
	lastTriggerAt int64                    // 上次触发时间（Unix 秒），用于冷却期合并
}

// probeGuardMemoryStore 是无 Redis 部署时的单机滑动窗口回退实现。
type probeGuardMemoryStore struct {
	mutex sync.Mutex
	users map[int]*probeGuardMemoryUser
}

var probeGuardMemory = &probeGuardMemoryStore{users: map[int]*probeGuardMemoryUser{}}

func (s *probeGuardMemoryStore) record(userId int, modelName string, windowSeconds int) ([]string, error) {
	now := time.Now().Unix()
	s.mutex.Lock()
	defer s.mutex.Unlock()

	user := s.users[userId]
	if user == nil {
		user = &probeGuardMemoryUser{}
		s.users[userId] = user
	}
	user.samples = pruneProbeGuardSamples(user.samples, now-int64(windowSeconds))
	user.samples = append(user.samples, probeGuardMemorySample{ts: now, model: modelName})
	s.sweepLocked(now)

	seen := make(map[string]struct{}, len(user.samples))
	models := make([]string, 0, len(user.samples))
	for _, sample := range user.samples {
		if _, ok := seen[sample.model]; ok {
			continue
		}
		seen[sample.model] = struct{}{}
		models = append(models, sample.model)
	}
	return models, nil
}

func (s *probeGuardMemoryStore) claimTrigger(userId int, cooldownSeconds int) bool {
	now := time.Now().Unix()
	s.mutex.Lock()
	defer s.mutex.Unlock()

	user := s.users[userId]
	if user != nil && now-user.lastTriggerAt < int64(cooldownSeconds) {
		return false
	}
	if user == nil {
		user = &probeGuardMemoryUser{}
		s.users[userId] = user
	}
	user.lastTriggerAt = now
	return true
}

// sweepLocked 在用户数超过上限时清理窗口已完全过期的用户，防止 map 无限增长。
func (s *probeGuardMemoryStore) sweepLocked(now int64) {
	if len(s.users) <= probeGuardMemoryMaxUsers {
		return
	}
	for userId, user := range s.users {
		if user.lastTriggerAt > 0 && now-user.lastTriggerAt < 86400 {
			continue
		}
		kept := pruneProbeGuardSamples(user.samples, now-86400)
		if len(kept) == 0 {
			delete(s.users, userId)
		} else {
			user.samples = kept
		}
	}
}

func pruneProbeGuardSamples(samples []probeGuardMemorySample, cutoff int64) []probeGuardMemorySample {
	kept := make([]probeGuardMemorySample, 0, len(samples))
	for _, sample := range samples {
		if sample.ts > cutoff {
			kept = append(kept, sample)
		}
	}
	return kept
}
