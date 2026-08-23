package middleware

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/glebarez/sqlite"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupProbeGuardMiddlewareEnv(t *testing.T) {
	t.Helper()

	previousDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	// :memory: 数据库按连接隔离，异步日志写入会触发新连接导致丢表，限制为单连接
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.Token{}, &model.ProbeGuardLog{}))
	model.DB = db

	previousRedisEnabled := common.RedisEnabled
	common.RedisEnabled = false

	settings := operation_setting.GetProbeGuardSettings()
	previousSettings := *settings
	settings.Enabled = true
	settings.DryRun = false
	settings.WindowSeconds = 1
	settings.ModelThreshold = 3
	settings.MaxTriggers = 2
	settings.ExcludedGroups = []string{}
	settings.WhitelistUserIds = ""

	t.Cleanup(func() {
		*settings = previousSettings
		common.RedisEnabled = previousRedisEnabled
		model.DB = previousDB
		_ = sqlDB.Close()
	})
}

func createProbeGuardUser(t *testing.T, id int, username string, role int) *model.User {
	t.Helper()
	user := &model.User{
		Id: id, Username: username, Password: "12345678",
		Role: role, Status: common.UserStatusEnabled, AffCode: username + "-aff",
	}
	require.NoError(t, model.DB.Create(user).Error)
	return user
}

func performProbeGuardRequest(userId, role int, group, modelName string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		common.SetContextKey(c, constant.ContextKeyUserId, userId)
		common.SetContextKey(c, constant.ContextKeyUserRole, role)
		common.SetContextKey(c, constant.ContextKeyUserGroup, group)
		common.SetContextKey(c, constant.ContextKeyTokenGroup, "")
		common.SetContextKey(c, constant.ContextKeyUserName, fmt.Sprintf("user%d", userId))
		common.SetContextKey(c, constant.ContextKeyTokenId, 42)
		c.Set("token_name", "probe-token")
		common.SetContextKey(c, constant.ContextKeyOriginalModel, modelName)
	}, ProbeGuard(), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	router.ServeHTTP(recorder, request)
	return recorder
}

func waitForProbeGuardLogCount(t *testing.T, want int64) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var count int64
		require.NoError(t, model.DB.Model(&model.ProbeGuardLog{}).Count(&count).Error)
		if count >= want {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	var count int64
	require.NoError(t, model.DB.Model(&model.ProbeGuardLog{}).Count(&count).Error)
	assert.GreaterOrEqual(t, count, want, "probe guard log rows should be recorded asynchronously")
}

func TestProbeGuardMiddlewareWarnsThenBansAcrossWindows(t *testing.T) {
	setupProbeGuardMiddlewareEnv(t)
	user := createProbeGuardUser(t, 101, "probe_flow_user", common.RoleCommonUser)

	// 窗口内第 3 个不同模型触发第一次违规：警告
	assert.Equal(t, http.StatusOK, performProbeGuardRequest(user.Id, common.RoleCommonUser, "default", "model-1").Code)
	assert.Equal(t, http.StatusOK, performProbeGuardRequest(user.Id, common.RoleCommonUser, "default", "model-2").Code)
	assert.Equal(t, http.StatusForbidden, performProbeGuardRequest(user.Id, common.RoleCommonUser, "default", "model-3").Code)
	// 同一冷却期内继续越界：拦截但不重复计数
	assert.Equal(t, http.StatusForbidden, performProbeGuardRequest(user.Id, common.RoleCommonUser, "default", "model-4").Code)

	var updated model.User
	require.NoError(t, model.DB.Where("id = ?", user.Id).First(&updated).Error)
	assert.Equal(t, 1, updated.ProbeGuardTriggerCount)
	assert.Equal(t, common.UserStatusEnabled, updated.Status)

	// 等待 1 秒窗口与冷却期过期，模拟下一轮测活
	time.Sleep(1200 * time.Millisecond)

	// 第二次违规达到 MaxTriggers=2：自动封禁
	assert.Equal(t, http.StatusOK, performProbeGuardRequest(user.Id, common.RoleCommonUser, "default", "model-5").Code)
	assert.Equal(t, http.StatusOK, performProbeGuardRequest(user.Id, common.RoleCommonUser, "default", "model-6").Code)
	assert.Equal(t, http.StatusForbidden, performProbeGuardRequest(user.Id, common.RoleCommonUser, "default", "model-7").Code)

	require.NoError(t, model.DB.Where("id = ?", user.Id).First(&updated).Error)
	assert.Equal(t, 2, updated.ProbeGuardTriggerCount)
	assert.Equal(t, common.UserStatusDisabled, updated.Status)
	assert.Equal(t, model.UserBanReasonBatchModelProbing, updated.BanReason)

	waitForProbeGuardLogCount(t, 2)
	var logs []model.ProbeGuardLog
	require.NoError(t, model.DB.Order("id ASC").Find(&logs).Error)
	require.Len(t, logs, 2)
	assert.Equal(t, model.ProbeGuardActionWarning, logs[0].ActionTaken)
	assert.Equal(t, model.ProbeGuardActionBanned, logs[1].ActionTaken)
	assert.Equal(t, 3, logs[0].DistinctCount)
	assert.Equal(t, 2, logs[1].TriggerCount)
}

func TestProbeGuardMiddlewareDryRunRecordsWithoutBlocking(t *testing.T) {
	setupProbeGuardMiddlewareEnv(t)
	user := createProbeGuardUser(t, 102, "probe_dry_run_user", common.RoleCommonUser)
	settings := operation_setting.GetProbeGuardSettings()
	settings.DryRun = true

	for _, modelName := range []string{"model-1", "model-2", "model-3", "model-4"} {
		assert.Equal(t, http.StatusOK, performProbeGuardRequest(user.Id, common.RoleCommonUser, "default", modelName).Code)
	}

	var updated model.User
	require.NoError(t, model.DB.Where("id = ?", user.Id).First(&updated).Error)
	assert.Equal(t, 0, updated.ProbeGuardTriggerCount, "dry-run 不应累计惩罚计数")
	assert.Equal(t, common.UserStatusEnabled, updated.Status)

	waitForProbeGuardLogCount(t, 1)
	var logs []model.ProbeGuardLog
	require.NoError(t, model.DB.Find(&logs).Error)
	require.Len(t, logs, 1)
	assert.Equal(t, model.ProbeGuardActionDryRun, logs[0].ActionTaken)
}

func TestProbeGuardMiddlewareSkipsExemptRequests(t *testing.T) {
	setupProbeGuardMiddlewareEnv(t)
	settings := operation_setting.GetProbeGuardSettings()

	// 管理员豁免：远超阈值也不拦截
	admin := createProbeGuardUser(t, 201, "probe_admin", common.RoleAdminUser)
	for i := 1; i <= 5; i++ {
		assert.Equal(t, http.StatusOK,
			performProbeGuardRequest(admin.Id, common.RoleAdminUser, "default", fmt.Sprintf("admin-model-%d", i)).Code)
	}

	// 分组豁免
	settings.ExcludedGroups = []string{"vip"}
	for i := 1; i <= 5; i++ {
		assert.Equal(t, http.StatusOK,
			performProbeGuardRequest(90002, common.RoleCommonUser, "vip", fmt.Sprintf("vip-model-%d", i)).Code)
	}

	// 用户白名单豁免
	settings.WhitelistUserIds = "90003"
	for i := 1; i <= 5; i++ {
		assert.Equal(t, http.StatusOK,
			performProbeGuardRequest(90003, common.RoleCommonUser, "default", fmt.Sprintf("white-model-%d", i)).Code)
	}
}
