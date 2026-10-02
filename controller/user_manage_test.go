package controller

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupManageUserTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	require.NoError(t, i18n.Init())
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousRedisEnabled, previousSecret := common.RedisEnabled, common.SessionSecret
	previousMainDatabaseType, previousLogDatabaseType := common.MainDatabaseType(), common.LogDatabaseType()
	dialect := os.Getenv("TEST_MANAGE_USER_DIALECT")
	if dialect == "" {
		dialect = "sqlite"
	}
	databaseTypes := map[string]common.DatabaseType{
		"sqlite": common.DatabaseTypeSQLite, "mysql": common.DatabaseTypeMySQL, "postgres": common.DatabaseTypePostgreSQL,
	}
	require.Contains(t, databaseTypes, dialect)
	dsn := os.Getenv("TEST_" + strings.ToUpper(dialect) + "_DSN")
	db, _ := newAuditTestDatabase(t, dialect, dsn)
	logDB := db
	if os.Getenv("TEST_MANAGE_USER_SEPARATE_LOG_DB") == "1" {
		logDB, _ = newAuditTestDatabase(t, dialect, dsn)
	}
	model.DB, model.LOG_DB = db, logDB
	common.RedisEnabled = false
	common.SessionSecret = "manage-user-test-secret"
	common.SetDatabaseTypes(databaseTypes[dialect], databaseTypes[dialect])

	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.RedisEnabled, common.SessionSecret = previousRedisEnabled, previousSecret
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
		if logDB != db {
			sqlLogDB, err := logDB.DB()
			if err == nil {
				_ = sqlLogDB.Close()
			}
		}
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.CasbinRule{}, &model.AuthzRole{}, &model.AuthFlow{}, &model.TwoFA{}, &model.PasskeyCredential{}, &model.UserAccessToken{}))
	require.NoError(t, logDB.AutoMigrate(&model.Log{}, &model.AuditLog{}))
	versionQuery := "SELECT version()"
	if dialect == "sqlite" {
		versionQuery = "SELECT sqlite_version()"
	}
	var version string
	require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
	t.Logf("database: %s %s, separate log database: %v", dialect, version, logDB != db)
	return db
}

func performManageUserRequest(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	return performVerifiedManageUserRequest(t, body, service.AuthIdentity{UserID: 9999}, "")
}

// performVerifiedManageUserRequest drives ManageUser as the root operator from
// a dashboard login session, carrying the step-up proof status or role changes need.
func performVerifiedManageUserRequest(t *testing.T, body string, identity service.AuthIdentity, proof string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/user/manage", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if proof != "" {
		c.Request.Header.Set("X-Security-Proof", proof)
	}
	c.Set("id", identity.UserID)
	c.Set("role", common.RoleRootUser)
	c.Set("username", "root-operator")
	c.Set("session_id", identity.SessionID)
	c.Set("auth_version", identity.UserAuthVersion)
	c.Set("session_version", identity.SessionVersion)
	c.Set(common.RequestIdKey, "quota-test-request")
	ManageUser(c)
	return recorder
}

// manageUserIdentity signs an operator in and returns the dashboard session
// identity AdminAuth would have built for it.
func manageUserIdentity(t *testing.T, operator *model.User) service.AuthIdentity {
	t.Helper()
	require.NoError(t, model.PublishUserAuthCache(operator.Id))
	bundle, err := service.CreateLoginSession(operator.Id, "password", "127.0.0.1", "manage-user-test")
	require.NoError(t, err)
	identity, err := service.ParseAccessToken(bundle.AccessToken)
	require.NoError(t, err)
	return identity
}

// manageUserProof signs the root operator in and issues a password-method proof
// bound to one ManageUser operation.
func manageUserProof(t *testing.T, db *gorm.DB, operation service.VerificationOperation) (service.AuthIdentity, string) {
	t.Helper()
	operator := createQuotaTestOperator(t, db, common.RoleRootUser)
	identity := manageUserIdentity(t, &operator)
	binding, err := service.BindVerificationOperation(operation)
	require.NoError(t, err)
	proof, _, err := service.IssueSecurityProof(identity, service.VerificationMethodPassword, binding)
	require.NoError(t, err)
	return identity, proof
}

func TestManageUserDisableAdvancesAuthVersionOnceAndRevokesSession(t *testing.T) {
	db := setupManageUserTestDB(t)
	now := time.Now().Unix()
	user := model.User{
		Username: "managed-disable-user", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1,
	}
	require.NoError(t, db.Create(&user).Error)
	require.NoError(t, db.Create(&model.UserSession{
		SID: "managed-disable-session", UserID: user.Id, Version: 1, UserAuthVersion: 1,
		Status: model.UserSessionStatusActive, RefreshHash: "refresh-hash", LoginMethod: "password",
		LastActiveAt: now, ExpiresAt: now + 3600,
	}).Error)

	identity, proof := manageUserProof(t, db, service.VerificationOperation{Scope: service.VerificationScopeAdminUserManage, Context: []byte(fmt.Sprintf(`{"user_id":%d,"action":"disable"}`, user.Id))})
	recorder := performVerifiedManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"disable"}`, user.Id), identity, proof)
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"success":true`)

	var updated model.User
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, common.UserStatusDisabled, updated.Status)
	assert.EqualValues(t, 2, updated.AuthVersion)
	var session model.UserSession
	require.NoError(t, db.First(&session, "sid = ?", "managed-disable-session").Error)
	assert.Equal(t, model.UserSessionStatusRevoked, session.Status)
}

func TestManageUserDemoteAdvancesAuthVersionAndRevokesSessionsOnce(t *testing.T) {
	db := setupManageUserTestDB(t)
	previousMaster := common.IsMasterNode
	common.IsMasterNode = false
	t.Cleanup(func() { common.IsMasterNode = previousMaster })
	require.NoError(t, authz.Init(db))

	now := time.Now().Unix()
	user := model.User{
		Username: "managed-demote-user", Password: "password", Role: common.RoleAdminUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1,
	}
	require.NoError(t, db.Create(&user).Error)
	for _, sid := range []string{"managed-demote-session-one", "managed-demote-session-two"} {
		require.NoError(t, db.Create(&model.UserSession{
			SID: sid, UserID: user.Id, Version: 1, UserAuthVersion: 1,
			Status: model.UserSessionStatusActive, RefreshHash: "refresh-" + sid, LoginMethod: "password",
			LastActiveAt: now, ExpiresAt: now + 3600,
		}).Error)
	}

	sessionUpdateCount := 0
	require.NoError(t, db.Callback().Update().Before("gorm:update").Register("test:count_demote_session_updates", func(tx *gorm.DB) {
		if tx.Statement != nil && tx.Statement.Table == "user_sessions" {
			sessionUpdateCount++
		}
	}))

	identity, proof := manageUserProof(t, db, service.VerificationOperation{Scope: service.VerificationScopeAdminUserManage, Context: []byte(fmt.Sprintf(`{"user_id":%d,"action":"demote"}`, user.Id))})
	recorder := performVerifiedManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"demote"}`, user.Id), identity, proof)
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"success":true`)

	var updated model.User
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, common.RoleCommonUser, updated.Role)
	assert.EqualValues(t, 2, updated.AuthVersion)
	var sessions []model.UserSession
	require.NoError(t, db.Where("user_id = ?", user.Id).Order("sid asc").Find(&sessions).Error)
	require.Len(t, sessions, 2)
	for _, session := range sessions {
		assert.Equal(t, model.UserSessionStatusRevoked, session.Status)
		assert.Equal(t, "admin_demote", session.RevokedReason)
	}
	assert.Equal(t, 1, sessionUpdateCount)
}

func TestManageUserDeleteReturnsImmediatelyAndUnknownActionFails(t *testing.T) {
	db := setupManageUserTestDB(t)
	deleted := model.User{
		Username: "managed-delete-user", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "delete-aff",
	}
	require.NoError(t, db.Create(&deleted).Error)

	identity, proof := manageUserProof(t, db, service.VerificationOperation{Scope: service.VerificationScopeAdminUserDelete, Context: []byte(fmt.Sprintf(`{"user_id":%d}`, deleted.Id))})
	recorder := performVerifiedManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"delete"}`, deleted.Id), identity, proof)
	assert.Contains(t, recorder.Body.String(), `"success":true`)
	var deletedCount int64
	require.NoError(t, db.Unscoped().Model(&model.User{}).Where("id = ? AND deleted_at IS NOT NULL", deleted.Id).Count(&deletedCount).Error)
	assert.EqualValues(t, 1, deletedCount)

	unchanged := model.User{
		Username: "managed-unknown-user", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "unknown-aff",
	}
	require.NoError(t, db.Create(&unchanged).Error)
	recorder = performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"unknown"}`, unchanged.Id))
	assert.Contains(t, recorder.Body.String(), `"success":false`)
	require.NoError(t, db.First(&unchanged, unchanged.Id).Error)
	assert.EqualValues(t, 1, unchanged.AuthVersion)
	assert.Equal(t, common.UserStatusEnabled, unchanged.Status)
}

func createQuotaTestOperator(t *testing.T, db *gorm.DB, role int) model.User {
	t.Helper()
	if role == 0 {
		role = common.RoleRootUser
	}
	operator := model.User{Id: 9999, Username: "root-operator", Password: "root-operator-hash", Role: role, Status: common.UserStatusEnabled, AuthVersion: 1, AffCode: "root-operator-aff"}
	require.NoError(t, db.Create(&operator).Error)
	return operator
}

func TestManageUserQuotaRecordsTopupAndAudit(t *testing.T) {
	for _, tc := range []struct {
		name, mode, action, content string
		value, wantQuota            int
	}{
		{"add", "add", "user.quota_add", "Increased user quota by 500", 500, 1500},
		{"subtract", "subtract", "user.quota_subtract", "Decreased user quota by 500", 500, 500},
		{"override_up", "override", "user.quota_override", "Overrode user quota from 1000 to 1500", 1500, 1500},
		{"override_down", "override", "user.quota_override", "Overrode user quota from 1000 to 500", 500, 500},
		{"override_unchanged", "override", "user.quota_override", "Overrode user quota from 1000 to 1000", 1000, 1000},
		{"override_zero", "override", "user.quota_override", "Overrode user quota from 1000 to 0", 0, 0},
		{"override_negative", "override", "user.quota_override", "Overrode user quota from 1000 to -1", -1, -1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := setupManageUserTestDB(t)
			user := model.User{Username: "quota-owner", Role: common.RoleCommonUser, Quota: 1000, AffCode: "quota-owner-aff"}
			require.NoError(t, db.Create(&user).Error)
			createQuotaTestOperator(t, db, common.RoleRootUser)

			recorder := performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"add_quota","mode":%q,"value":%d}`, user.Id, tc.mode, tc.value))
			assert.Equal(t, http.StatusOK, recorder.Code)
			require.Contains(t, recorder.Body.String(), `"success":true`)
			require.NoError(t, db.First(&user, user.Id).Error)
			assert.Equal(t, tc.wantQuota, user.Quota)

			logs, total, err := model.GetAllLogs(model.LogTypeTopup, 0, 0, "", "", "", 0, 20, 0, "", "", "")
			require.NoError(t, err)
			assert.EqualValues(t, 1, total)
			require.Len(t, logs, 1)
			assert.Equal(t, user.Id, logs[0].UserId)
			assert.Equal(t, user.Username, logs[0].Username)
			assert.Equal(t, tc.content, logs[0].Content)
			model.FormatAdminLogs(logs)
			var other model.AuditOther
			require.NoError(t, common.UnmarshalJsonStr(logs[0].Other, &other))
			assert.Equal(t, &model.AuditAdminInfo{AdminID: 9999, AdminUsername: "root-operator", AdminRole: common.RoleRootUser, AuthMethod: "session"}, other.AdminInfo)

			logs, total, err = model.GetUserLogs(user.Id, model.LogTypeTopup, 0, 0, "", "", 0, 20, "", "", "")
			require.NoError(t, err)
			assert.EqualValues(t, 1, total)
			require.Len(t, logs, 1)
			other = model.AuditOther{}
			require.NoError(t, common.UnmarshalJsonStr(logs[0].Other, &other))
			assert.Nil(t, other.AdminInfo)
			require.NotNil(t, other.Op)
			assert.Equal(t, tc.action, other.Op.Action)
			params, err := common.Marshal(other.Op.Params)
			require.NoError(t, err)
			expectedParams := model.AuditFields{"target_user_id": user.Id, "target_username": user.Username, "mode": tc.mode, "requested_quota": tc.value, "from": 1000, "to": tc.wantQuota}
			if tc.mode != "override" {
				expectedParams["quota"] = tc.value
			}
			expected, err := common.Marshal(expectedParams)
			require.NoError(t, err)
			assert.JSONEq(t, string(expected), string(params))
			assert.Equal(t, "quota-test-request", logs[0].RequestId)
			assert.Empty(t, logs[0].Ip, "recipient logs must not disclose the administrator IP")

			logs, total, err = model.GetUserLogs(9999, model.LogTypeTopup, 0, 0, "", "", 0, 20, "", "", "")
			require.NoError(t, err)
			assert.Zero(t, total)
			assert.Empty(t, logs)
			var audits []model.AuditLog
			require.NoError(t, model.LOG_DB.Find(&audits).Error)
			require.Len(t, audits, 1)
			assert.Equal(t, 9999, audits[0].UserId)
			assert.Equal(t, "root-operator", audits[0].Username)
			assert.Equal(t, tc.action, audits[0].Action)
			assert.True(t, audits[0].Success)
			params, err = common.Marshal(audits[0].Other.Op.Params)
			require.NoError(t, err)
			assert.JSONEq(t, string(expected), string(params))
			assert.Equal(t, "quota-test-request", audits[0].RequestId)
		})
	}
}

func TestManageUserQuotaFailuresDoNotRecordTopup(t *testing.T) {
	for _, tc := range []struct {
		name, mode string
		value      int
		failUpdate bool
	}{
		{"zero_add", "add", 0, false},
		{"negative_subtract", "subtract", -1, false},
		{"invalid_mode", "invalid", 500, false},
		{"add_update_error", "add", 500, true},
		{"subtract_update_error", "subtract", 500, true},
		{"override_update_error", "override", 500, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := setupManageUserTestDB(t)
			createQuotaTestOperator(t, db, common.RoleRootUser)
			user := model.User{Username: "quota-owner", Role: common.RoleCommonUser, Quota: 1000}
			require.NoError(t, db.Create(&user).Error)
			if tc.failUpdate {
				require.NoError(t, db.Callback().Update().Before("gorm:update").Register("test:fail_quota_update", func(tx *gorm.DB) {
					if tx.Statement.Table == "users" {
						tx.AddError(errors.New("quota update unavailable"))
					}
				}))
			}
			recorder := performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"add_quota","mode":%q,"value":%d}`, user.Id, tc.mode, tc.value))
			assert.Contains(t, recorder.Body.String(), `"success":false`)
			require.NoError(t, db.First(&user, user.Id).Error)
			assert.Equal(t, 1000, user.Quota)
			var logCount, auditCount int64
			require.NoError(t, model.LOG_DB.Model(&model.Log{}).Count(&logCount).Error)
			require.NoError(t, model.LOG_DB.Model(&model.AuditLog{}).Count(&auditCount).Error)
			assert.Zero(t, logCount)
			assert.EqualValues(t, 1, auditCount)
			var audit model.AuditLog
			require.NoError(t, model.LOG_DB.First(&audit).Error)
			assert.False(t, audit.Success)
			params, err := common.Marshal(audit.Other.Op.Params)
			require.NoError(t, err)
			assert.NotContains(t, string(params), `"from"`)
			assert.NotContains(t, string(params), `"to"`)
			assert.NotContains(t, string(params), `"target_username"`)
			assert.NotContains(t, string(params), "quota update unavailable")
			reason := "invalid_parameters"
			if tc.failUpdate {
				reason = "database_error"
			}
			assert.Contains(t, string(params), `"failure_reason":"`+reason+`"`)
			assert.Contains(t, string(params), fmt.Sprintf(`"requested_quota":%d`, tc.value))
		})
	}
}

func TestManageUserQuotaLogFailureKeepsSuccessfulAdjustment(t *testing.T) {
	for _, failedTable := range []string{"logs", "audit_logs"} {
		t.Run(failedTable, func(t *testing.T) {
			db := setupManageUserTestDB(t)
			createQuotaTestOperator(t, db, common.RoleRootUser)
			user := model.User{Username: "quota-owner", Role: common.RoleCommonUser, Quota: 1000}
			require.NoError(t, db.Create(&user).Error)
			require.NoError(t, model.LOG_DB.Callback().Create().Before("gorm:create").Register("test:fail_quota_log", func(tx *gorm.DB) {
				if tx.Statement.Table == failedTable {
					tx.AddError(errors.New("quota log unavailable"))
				}
			}))
			recorder := performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"add_quota","mode":"add","value":500}`, user.Id))
			assert.Contains(t, recorder.Body.String(), `"success":true`)
			require.NoError(t, db.First(&user, user.Id).Error)
			assert.Equal(t, 1500, user.Quota)
			var logCount, auditCount int64
			require.NoError(t, model.LOG_DB.Model(&model.Log{}).Count(&logCount).Error)
			require.NoError(t, model.LOG_DB.Model(&model.AuditLog{}).Count(&auditCount).Error)
			if failedTable == "logs" {
				assert.Zero(t, logCount)
				assert.EqualValues(t, 1, auditCount)
			} else {
				assert.EqualValues(t, 1, logCount)
				assert.Zero(t, auditCount)
			}
		})
	}
}

func TestManageUserQuotaTargetsAndWalletBounds(t *testing.T) {
	for _, tc := range []struct {
		name, mode, reason                                string
		before, value, targetID, targetRole, operatorRole int
		deleted, failRead                                 bool
	}{
		{name: "zero_id", mode: "add", value: 1, reason: "invalid_parameters"},
		{name: "negative_id", mode: "subtract", value: 1, targetID: -1, reason: "invalid_parameters"},
		{name: "missing", mode: "override", value: 1, targetID: 12345, reason: "target_not_found"},
		{name: "deleted", mode: "add", value: 1, targetID: 1, deleted: true, reason: "target_not_found"},
		{name: "peer_admin", mode: "add", value: 1, targetID: 1, targetRole: common.RoleAdminUser, operatorRole: common.RoleAdminUser, reason: "permission_denied"},
		{name: "higher_role", mode: "override", value: 1, targetID: 1, targetRole: common.RoleRootUser, operatorRole: common.RoleAdminUser, reason: "permission_denied"},
		{name: "read_error", mode: "add", value: 1, targetID: 1, failRead: true, reason: "database_error"},
		{name: "add_overflow", mode: "add", before: common.MaxWalletQuota, value: 1, targetID: 1, reason: "quota_limit_exceeded"},
		{name: "subtract_underflow", mode: "subtract", before: -common.MaxWalletQuota, value: 1, targetID: 1, reason: "quota_limit_exceeded"},
		{name: "oversized_add", mode: "add", value: common.MaxWalletQuota + 1, targetID: 1, reason: "quota_limit_exceeded"},
		{name: "oversized_subtract", mode: "subtract", value: common.MaxWalletQuota + 1, targetID: 1, reason: "quota_limit_exceeded"},
		{name: "oversized_override", mode: "override", value: -common.MaxWalletQuota - 1, targetID: 1, reason: "quota_limit_exceeded"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := setupManageUserTestDB(t)
			createQuotaTestOperator(t, db, tc.operatorRole)
			user := model.User{Id: 1, Username: "private-target-name", Role: tc.targetRole, Quota: tc.before}
			require.NoError(t, db.Create(&user).Error)
			if tc.deleted {
				require.NoError(t, db.Delete(&user).Error)
			}
			if tc.failRead {
				require.NoError(t, db.Callback().Query().Before("gorm:query").Register("test:quota_read_error", func(tx *gorm.DB) {
					if tx.Statement.Table == "users" && len(tx.Statement.Selects) == 0 {
						tx.AddError(errors.New("private database error"))
					}
				}))
			}
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/api/user/manage", strings.NewReader(fmt.Sprintf(`{"id":%d,"action":"add_quota","mode":%q,"value":%d}`, tc.targetID, tc.mode, tc.value)))
			role := tc.operatorRole
			if role == 0 {
				role = common.RoleRootUser
			}
			c.Set("id", 9999)
			c.Set("role", role)
			ManageUser(c)
			require.Contains(t, recorder.Body.String(), `"success":false`)
			if tc.failRead {
				require.NoError(t, db.Callback().Query().Remove("test:quota_read_error"))
			}
			require.NoError(t, db.Unscoped().First(&user, user.Id).Error)
			assert.Equal(t, tc.before, user.Quota)
			var audits []model.AuditLog
			require.NoError(t, model.LOG_DB.Find(&audits).Error)
			require.Len(t, audits, 1)
			assert.False(t, audits[0].Success)
			params, err := common.Marshal(audits[0].Other.Op.Params)
			require.NoError(t, err)
			expected, err := common.Marshal(model.AuditFields{"target_user_id": tc.targetID, "mode": tc.mode, "requested_quota": tc.value, "failure_reason": tc.reason})
			require.NoError(t, err)
			assert.JSONEq(t, string(expected), string(params))
			assert.NotContains(t, audits[0].Content, user.Username)
			var count int64
			require.NoError(t, model.LOG_DB.Model(&model.Log{}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

func TestManageUserQuotaMiddlewareKeepsOneOperationPerRequest(t *testing.T) {
	db := setupManageUserTestDB(t)
	pat := "quota-middleware-test-token"
	operator := model.User{Id: 9999, Username: "root-operator", Role: common.RoleRootUser, Status: common.UserStatusEnabled, AuthVersion: 1, AccessToken: &pat, Quota: 1000}
	require.NoError(t, db.Create(&operator).Error)
	router := gin.New()
	router.Use(middleware.RequestId(), middleware.AccessTokenAudit())
	router.POST("/api/user/manage", middleware.AdminAuth(), ManageUser)
	for _, tc := range []struct {
		body, action string
		success      bool
	}{
		{`{"id":9999,"action":"add_quota","mode":"add","value":100}`, "user.quota_add", true},
		{`{"id":9999,"action":"add_quota","mode":"subtract","value":0}`, "user.quota_subtract", false},
		{`{"id":9999,"action":"add_quota","mode":"invalid","value":1}`, "generic", false},
		{`{"id":`, "generic", false},
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/user/manage", strings.NewReader(tc.body))
		request.Header.Set("Authorization", "Bearer "+pat)
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)
		assert.Equal(t, http.StatusOK, recorder.Code)
		assert.Contains(t, recorder.Body.String(), fmt.Sprintf(`"success":%t`, tc.success))
		requestID := recorder.Header().Get(common.RequestIdKey)
		require.NotEmpty(t, requestID)
		var audits []model.AuditLog
		require.NoError(t, model.LOG_DB.Where("request_id = ?", requestID).Find(&audits).Error)
		require.Len(t, audits, 2, "one operation audit and one PAT request audit")
		for _, audit := range audits {
			assert.Equal(t, tc.success, audit.Success)
			if audit.Category != model.AuditCategoryOperation {
				continue
			}
			assert.Equal(t, tc.action, audit.Action)
			assert.Equal(t, operator.Id, audit.UserId)
			assert.Equal(t, "/api/user/manage", audit.Route)
			if tc.success {
				params, err := common.Marshal(audit.Other.Op.Params)
				require.NoError(t, err)
				assert.Contains(t, string(params), `"target_user_id":9999`)
				assert.Contains(t, string(params), `"target_username":"root-operator"`)
			}
		}
		var count int64
		require.NoError(t, model.LOG_DB.Model(&model.Log{}).Where("request_id = ?", requestID).Count(&count).Error)
		if tc.success {
			assert.EqualValues(t, 1, count)
		} else {
			assert.Zero(t, count)
		}
	}
	require.NoError(t, db.First(&operator, operator.Id).Error)
	assert.Equal(t, 1100, operator.Quota)
}

func TestManageUserQuotaConcurrentSnapshots(t *testing.T) {
	db := setupManageUserTestDB(t)
	user := model.User{Username: "concurrent-quota", Quota: 1000}
	require.NoError(t, db.Create(&user).Error)
	var ready sync.WaitGroup
	ready.Add(2)
	release := make(chan struct{})
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register("test:concurrent_quota_start", func(tx *gorm.DB) {
		if tx.Statement.Table == "users" {
			ready.Done()
			<-release
		}
	}))
	type result struct {
		adjustment *model.UserQuotaAdjustment
		err        error
		value      int
	}
	results := make(chan result, 2)
	for _, value := range []int{10, 20} {
		go func(value int) {
			adjustment, err := model.AdjustUserQuota(user.Id, common.RoleRootUser, "add", value)
			results <- result{adjustment, err, value}
		}(value)
	}
	ready.Wait()
	close(release)
	var committed []model.UserQuotaAdjustment
	for range 2 {
		result := <-results
		if result.err != nil {
			require.True(t, common.UsingMainDatabase(common.DatabaseTypeSQLite), "row-locking databases must serialize both adjustments: %v", result.err)
			assert.Contains(t, strings.ToLower(result.err.Error()), "locked")
			assert.Nil(t, result.adjustment)
			continue
		}
		require.NotNil(t, result.adjustment)
		assert.Equal(t, result.value, result.adjustment.After-result.adjustment.Before)
		committed = append(committed, *result.adjustment)
	}
	require.NoError(t, db.Callback().Query().Remove("test:concurrent_quota_start"))
	require.NotEmpty(t, committed)
	sort.Slice(committed, func(i, j int) bool { return committed[i].Before < committed[j].Before })
	balance := 1000
	for _, adjustment := range committed {
		assert.Equal(t, balance, adjustment.Before)
		balance = adjustment.After
	}
	require.NoError(t, db.First(&user, user.Id).Error)
	assert.Equal(t, balance, user.Quota)
}

func TestManageUserQuotaCacheUsesCommittedIntegerDifference(t *testing.T) {
	for _, tc := range []struct {
		name, mode                               string
		before, cached, value, after, wantCached int
		failUpdate, failCache, missingCache      bool
	}{
		{name: "add_preserves_reservations", mode: "add", before: 1000, cached: 900, value: 500, after: 1500, wantCached: 1400},
		{name: "subtract_preserves_reservations", mode: "subtract", before: 1000, cached: 900, value: 500, after: 500, wantCached: 400},
		{name: "override_preserves_reservations", mode: "override", before: 1000, cached: 900, value: 2000, after: 2000, wantCached: 1900},
		{name: "large_odd_difference", mode: "override", before: common.MaxWalletQuota - 1, cached: common.MaxWalletQuota - 1, value: -common.MaxWalletQuota, after: -common.MaxWalletQuota, wantCached: -common.MaxWalletQuota},
		{name: "rollback_does_not_change_cache", mode: "subtract", before: 1000, cached: 900, value: 500, after: 1000, wantCached: 900, failUpdate: true},
		{name: "cache_error_keeps_committed_change", mode: "add", before: 1000, value: 500, after: 1500, failCache: true},
		{name: "missing_cache_is_not_partially_created", mode: "add", before: 1000, value: 500, after: 1500, missingCache: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := setupManageUserTestDB(t)
			operator := createQuotaTestOperator(t, db, common.RoleRootUser)
			server := miniredis.RunT(t)
			oldRDB := common.RDB
			common.RDB = redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
			common.RedisEnabled = true
			t.Cleanup(func() { _ = common.RDB.Close(); common.RDB = oldRDB })
			user := model.User{Username: "cached-quota", Quota: tc.before, AuthVersion: 1}
			require.NoError(t, db.Create(&user).Error)
			cache, err := model.GetUserCache(user.Id)
			require.NoError(t, err)
			assert.Equal(t, tc.before, cache.Quota)
			_, err = model.GetUserCache(operator.Id)
			require.NoError(t, err)
			keys := server.Keys()
			var quotaKey string
			for _, key := range keys {
				if server.HGet(key, "Id") == strconv.Itoa(user.Id) && server.HGet(key, "Quota") != "" {
					quotaKey = key
					break
				}
			}
			require.NotEmpty(t, quotaKey)
			server.HSet(quotaKey, "Quota", strconv.Itoa(tc.cached))
			if tc.missingCache {
				server.Del(quotaKey)
			}
			if tc.failCache {
				server.SetError("ERR quota cache unavailable")
			}
			if tc.failUpdate {
				require.NoError(t, db.Callback().Update().After("gorm:update").Register("test:cache_quota_rollback", func(tx *gorm.DB) {
					if tx.Statement.Table == "users" {
						tx.AddError(errors.New("quota rollback"))
					}
				}))
			}
			recorder := performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"add_quota","mode":%q,"value":%d}`, user.Id, tc.mode, tc.value))
			assert.Contains(t, recorder.Body.String(), fmt.Sprintf(`"success":%t`, !tc.failUpdate))
			require.NoError(t, db.First(&user, user.Id).Error)
			assert.Equal(t, tc.after, user.Quota)
			if tc.missingCache {
				// Log username lookup may hydrate the whole user after commit.
				if server.Exists(quotaKey) {
					assert.Equal(t, strconv.Itoa(user.Id), server.HGet(quotaKey, "Id"))
					assert.NotEmpty(t, server.HGet(quotaKey, "CacheSchema"))
					assert.Equal(t, strconv.Itoa(tc.after), server.HGet(quotaKey, "Quota"))
				}
			} else if !tc.failCache {
				assert.Equal(t, strconv.Itoa(tc.wantCached), server.HGet(quotaKey, "Quota"))
			}
		})
	}
}

func TestManageUserDisablePersistsReasonAndEnableClearsIt(t *testing.T) {
	db := setupManageUserTestDB(t)
	user := model.User{
		Username: "managed-ban-reason-user", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1,
	}
	require.NoError(t, db.Create(&user).Error)

	// Disabling and enabling now require a step-up proof bound to the action.
	disableIdentity, disableProof := manageUserProof(t, db, service.VerificationOperation{Scope: service.VerificationScopeAdminUserManage, Context: []byte(fmt.Sprintf(`{"user_id":%d,"action":"disable"}`, user.Id))})
	recorder := performVerifiedManageUserRequest(t, fmt.Sprintf(
		`{"id":%d,"action":"disable","ban_reason":"%s"}`,
		user.Id,
		model.UserBanReasonProhibitedWords,
	), disableIdentity, disableProof)
	assert.Contains(t, recorder.Body.String(), `"success":true`)

	var disabled model.User
	require.NoError(t, db.First(&disabled, user.Id).Error)
	assert.Equal(t, common.UserStatusDisabled, disabled.Status)
	assert.Equal(t, model.UserBanReasonProhibitedWords, disabled.BanReason)

	enableIdentity, enableProof := manageUserProof(t, db, service.VerificationOperation{Scope: service.VerificationScopeAdminUserManage, Context: []byte(fmt.Sprintf(`{"user_id":%d,"action":"enable"}`, user.Id))})
	recorder = performVerifiedManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"enable"}`, user.Id), enableIdentity, enableProof)
	assert.Contains(t, recorder.Body.String(), `"success":true`)

	var enabled model.User
	require.NoError(t, db.First(&enabled, user.Id).Error)
	assert.Equal(t, common.UserStatusEnabled, enabled.Status)
	assert.Empty(t, enabled.BanReason)
}

func TestUserBannedMessageUsesCustomReasonAndFallsBackWhenEmpty(t *testing.T) {
	previousTranslate := common.TranslateMessage
	common.TranslateMessage = func(_ *gin.Context, key string, args ...map[string]any) string {
		if key == i18n.MsgAuthUserBannedBatchInviteSubaccounts {
			return "用户因批量邀请小号被封禁"
		}
		if key == i18n.MsgAuthUserBannedInactive15DaysNoAPICalls {
			return "用户已被封禁：超过15天未登录且无 API 调用记录"
		}
		if key == i18n.MsgAuthUserBannedCustom {
			return fmt.Sprintf("User has been banned: %s", args[0]["Reason"])
		}
		return key
	}
	t.Cleanup(func() { common.TranslateMessage = previousTranslate })

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	assert.Equal(t, "用户因批量邀请小号被封禁", userBannedMessage(c, &model.User{BanReason: model.UserBanReasonBatchInviteSubaccounts}, i18n.MsgAuthUserBanned))
	assert.Equal(t, "用户已被封禁：超过15天未登录且无 API 调用记录", userBannedMessage(c, &model.User{BanReason: model.UserBanReasonInactive15DaysNoAPICalls}, i18n.MsgAuthUserBanned))
	assert.Equal(t, "User has been banned: repeated abuse", userBannedMessage(c, &model.User{BanReason: "repeated abuse"}, i18n.MsgAuthUserBanned))
	assert.Equal(t, i18n.MsgAuthUserBanned, userBannedMessage(c, &model.User{}, i18n.MsgAuthUserBanned))
}

func TestManageUserQuotaRespectsWalletCeiling(t *testing.T) {
	db := setupManageUserTestDB(t)
	user := model.User{
		Username: "managed-quota-user", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", Quota: common.MaxWalletQuota - 1,
	}
	require.NoError(t, db.Create(&user).Error)

	recorder := performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"add_quota","mode":"add","value":2}`, user.Id))
	assert.Contains(t, recorder.Body.String(), `"success":false`)

	var updated model.User
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, common.MaxWalletQuota-1, updated.Quota)

	recorder = performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"add_quota","mode":"override","value":%d}`, user.Id, common.MaxWalletQuota+1))
	assert.Contains(t, recorder.Body.String(), `"success":false`)
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, common.MaxWalletQuota-1, updated.Quota)
}

// userFilterPreview drives the read-only preview and returns the matched ids.
func userFilterPreview(t *testing.T, operatorID, role int, body string) ([]int, int64, bool) {
	t.Helper()
	response := adminUserRequest(http.MethodPost, "/api/user/filter", body, "",
		service.AuthIdentity{UserID: operatorID}, role, nil, FilterUsers)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			Items []struct {
				Id int `json:"id"`
			} `json:"items"`
			Ids       []int `json:"ids"`
			Total     int64 `json:"total"`
			Truncated bool  `json:"truncated"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &envelope), response.Body.String())
	require.True(t, envelope.Success, response.Body.String())
	ids := append([]int{}, envelope.Data.Ids...)
	for _, item := range envelope.Data.Items {
		ids = append(ids, item.Id)
	}
	return ids, envelope.Data.Total, envelope.Data.Truncated
}

// The preview candidate query only counts consume logs as activity, drops root
// targets and the operator, and shares the role filter with the batch actions.
func TestFilterUsersPreviewConditionAndOperatorScope(t *testing.T) {
	db := setupManageUserTestDB(t)
	createQuotaTestOperator(t, db, common.RoleRootUser)
	seed := func(username string, role, status int, lastLogin int64) *model.User {
		user := model.User{Username: username, Role: role, Status: status, Group: "default", AuthVersion: 1, LastLoginAt: lastLogin, AffCode: username + "-aff"}
		require.NoError(t, db.Create(&user).Error)
		return &user
	}
	active := seed("filter-active", common.RoleCommonUser, common.UserStatusEnabled, 2000)
	inactive := seed("filter-inactive", common.RoleCommonUser, common.UserStatusEnabled, 100)
	neverLoggedIn := seed("filter-never", common.RoleCommonUser, common.UserStatusEnabled, 0)
	seed("filter-disabled", common.RoleCommonUser, common.UserStatusDisabled, 100)
	promoted := seed("filter-admin", common.RoleAdminUser, common.UserStatusEnabled, 2000)
	require.NoError(t, db.Create(&model.Log{UserId: active.Id, CreatedAt: 3000, Type: model.LogTypeConsume}).Error)
	// A top-up log is not an API call: a user with only top-up history stays inactive.
	require.NoError(t, db.Create(&model.Log{UserId: promoted.Id, CreatedAt: 3000, Type: model.LogTypeTopup}).Error)

	ids, total, _ := userFilterPreview(t, 9999, common.RoleRootUser, `{"last_login_before":1000}`)
	assert.EqualValues(t, 1, total)
	assert.Equal(t, []int{inactive.Id}, ids)

	ids, total, _ = userFilterPreview(t, 9999, common.RoleRootUser, `{"last_call_before":3000}`)
	assert.EqualValues(t, 3, total)
	assert.ElementsMatch(t, []int{inactive.Id, neverLoggedIn.Id, promoted.Id}, ids)

	// AND keeps only users that fail both activity checks: the recently logged-in
	// admin still has no consume log, but its recent login keeps it out.
	ids, total, _ = userFilterPreview(t, 9999, common.RoleRootUser, `{"last_login_before":1000,"last_call_before":3000}`)
	assert.EqualValues(t, 1, total)
	assert.Equal(t, []int{inactive.Id}, ids)

	ids, _, _ = userFilterPreview(t, 9999, common.RoleRootUser, `{"last_call_before":3000,"page":1,"page_size":2}`)
	require.Len(t, ids, 2)
	ids, total, _ = userFilterPreview(t, 9999, common.RoleRootUser, `{"last_call_before":3000,"page":2,"page_size":2}`)
	assert.EqualValues(t, 3, total)
	assert.Len(t, ids, 1)

	ids, total, truncated := userFilterPreview(t, 9999, common.RoleRootUser, `{"last_call_before":3000,"ids_only":true}`)
	assert.EqualValues(t, 3, total)
	assert.False(t, truncated)
	assert.Equal(t, []int{inactive.Id, neverLoggedIn.Id, promoted.Id}, ids, "ids_only returns ids in a stable order")

	// A non-root operator only ever previews users below its own role.
	adminOperator := model.User{Id: 9998, Username: "filter-admin-operator", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, AuthVersion: 1, AffCode: "filter-admin-operator-aff"}
	require.NoError(t, db.Create(&adminOperator).Error)
	ids, total, _ = userFilterPreview(t, adminOperator.Id, common.RoleAdminUser, `{"last_call_before":3000}`)
	assert.EqualValues(t, 2, total)
	assert.ElementsMatch(t, []int{inactive.Id, neverLoggedIn.Id}, ids)
}

// Batch ban by ids runs the single-ban chain per user and reports per-user failures.
func TestBanUsersByIdsAppliesSingleBanSemantics(t *testing.T) {
	db := setupManageUserTestDB(t)
	operator := createQuotaTestOperator(t, db, common.RoleRootUser)
	identity := manageUserIdentity(t, &operator)
	now := time.Now().Unix()
	first := model.User{Username: "batch-ban-first", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "batch-ban-first-aff"}
	second := model.User{Username: "batch-ban-second", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "batch-ban-second-aff"}
	require.NoError(t, db.Create(&first).Error)
	require.NoError(t, db.Create(&second).Error)
	require.NoError(t, db.Create(&model.UserSession{
		SID: "batch-ban-session", UserID: first.Id, Version: 1, UserAuthVersion: 1,
		Status: model.UserSessionStatusActive, RefreshHash: "batch-ban-refresh", LoginMethod: "password",
		LastActiveAt: now, ExpiresAt: now + 3600,
	}).Error)

	body := fmt.Sprintf(`{"ids":[%d,%d,%d],"ban_reason":"batch_activity_check"}`, second.Id, first.Id, first.Id)
	response := adminUserRequest(http.MethodPost, "/api/user/ban_by_ids", body, "", identity, common.RoleRootUser, nil, BanUsersByIds)
	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			Banned int `json:"banned"`
			Failed []struct {
				Id     int    `json:"id"`
				Reason string `json:"reason"`
			} `json:"failed"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &envelope), response.Body.String())
	require.True(t, envelope.Success, response.Body.String())
	assert.Equal(t, 2, envelope.Data.Banned)
	assert.Empty(t, envelope.Data.Failed)

	for _, id := range []int{first.Id, second.Id} {
		stored, err := model.GetUserById(id, false)
		require.NoError(t, err)
		assert.Equal(t, common.UserStatusDisabled, stored.Status)
		assert.Equal(t, model.UserBanReasonBatchActivityCheck, stored.BanReason)
		assert.EqualValues(t, 2, stored.AuthVersion)
	}
	var session model.UserSession
	require.NoError(t, db.First(&session, "sid = ?", "batch-ban-session").Error)
	assert.Equal(t, model.UserSessionStatusRevoked, session.Status)

	var audits []model.AuditLog
	require.NoError(t, model.LOG_DB.Where("action = ?", "user.ban_by_ids").Find(&audits).Error)
	require.Len(t, audits, 1)
	require.NotNil(t, audits[0].Other.Op)
	banned, err := common.Marshal(audits[0].Other.Op.Params["banned"])
	require.NoError(t, err)
	assert.JSONEq(t, "2", string(banned))
	requested, err := common.Marshal(audits[0].Other.Op.Params["requested"])
	require.NoError(t, err)
	assert.JSONEq(t, "2", string(requested), "repeated ids are de-duplicated")
}

// Protected targets, permission boundaries and malformed batches are rejected
// without touching the target accounts.
func TestBanUsersByIdsRejectsProtectedTargetsAndInvalidBatches(t *testing.T) {
	db := setupManageUserTestDB(t)
	operator := createQuotaTestOperator(t, db, common.RoleRootUser)
	identity := manageUserIdentity(t, &operator)
	peer := model.User{Username: "batch-ban-peer", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "batch-ban-peer-aff"}
	require.NoError(t, db.Create(&peer).Error)

	// The root target and the operator itself are never banned.
	response := adminUserRequest(http.MethodPost, "/api/user/ban_by_ids",
		fmt.Sprintf(`{"ids":[%d]}`, operator.Id), "", identity, common.RoleRootUser, nil, BanUsersByIds)
	var forbidden struct {
		Success bool `json:"success"`
		Data    struct {
			Banned int `json:"banned"`
			Failed []struct {
				Id     int    `json:"id"`
				Reason string `json:"reason"`
			} `json:"failed"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &forbidden), response.Body.String())
	require.True(t, forbidden.Success, response.Body.String())
	assert.Zero(t, forbidden.Data.Banned)
	require.Len(t, forbidden.Data.Failed, 1)
	assert.Equal(t, batchFailureForbidden, forbidden.Data.Failed[0].Reason)

	// A non-root operator is denied outright without a step-up proof.
	response = adminUserRequest(http.MethodPost, "/api/user/ban_by_ids",
		fmt.Sprintf(`{"ids":[%d]}`, peer.Id), "", identity, common.RoleAdminUser, nil, BanUsersByIds)
	var denied securityEnrollmentResponse
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &denied), response.Body.String())
	assert.Equal(t, http.StatusForbidden, response.Code)
	assert.Equal(t, "SECURITY_PROOF_REQUIRED", denied.Code)

	// A proof cannot lift the role hierarchy: a peer admin stays untouched.
	proof := issueSecurityEnrollmentProof(t, identity, service.VerificationOperation{
		Scope:   service.VerificationScopeAdminUserBanByIds,
		Context: []byte(fmt.Sprintf(`{"ids":[%d]}`, peer.Id)),
	}, service.VerificationMethodPassword)
	response = adminUserRequest(http.MethodPost, "/api/user/ban_by_ids",
		fmt.Sprintf(`{"ids":[%d]}`, peer.Id), proof, identity, common.RoleAdminUser, nil, BanUsersByIds)
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &forbidden), response.Body.String())
	require.True(t, forbidden.Success, response.Body.String())
	require.Len(t, forbidden.Data.Failed, 1)
	assert.Equal(t, batchFailurePermission, forbidden.Data.Failed[0].Reason)
	stored, err := model.GetUserById(peer.Id, false)
	require.NoError(t, err)
	assert.Equal(t, common.UserStatusEnabled, stored.Status)

	// Oversized id lists, oversized reasons and empty batches are rejected
	// before any lookup.
	ids := make([]int, 0, maxBatchUserIds+1)
	for i := range maxBatchUserIds + 1 {
		ids = append(ids, i+1)
	}
	oversized, err := common.Marshal(BanUsersByIdsRequest{Ids: ids})
	require.NoError(t, err)
	response = adminUserRequest(http.MethodPost, "/api/user/ban_by_ids", string(oversized), "", identity, common.RoleRootUser, nil, BanUsersByIds)
	assert.Contains(t, response.Body.String(), `"success":false`)
	longReason, err := common.Marshal(BanUsersByIdsRequest{Ids: []int{peer.Id}, BanReason: strings.Repeat("x", 256)})
	require.NoError(t, err)
	response = adminUserRequest(http.MethodPost, "/api/user/ban_by_ids", string(longReason), "", identity, common.RoleRootUser, nil, BanUsersByIds)
	assert.Contains(t, response.Body.String(), `"success":false`)
	response = adminUserRequest(http.MethodPost, "/api/user/ban_by_ids", `{"ids":[]}`, "", identity, common.RoleRootUser, nil, BanUsersByIds)
	assert.Contains(t, response.Body.String(), `"success":false`)
}

// Batch quota applies the per-user ratio, keeps wallet bounds, and writes the
// top-up log and audit rows the single-user path writes.
func TestBatchAdjustUserQuotaComputesRatioAndRecordsLedgers(t *testing.T) {
	db := setupManageUserTestDB(t)
	operator := createQuotaTestOperator(t, db, common.RoleRootUser)
	identity := manageUserIdentity(t, &operator)
	account := func(username string, role, quota int) *model.User {
		user := model.User{Username: username, Role: role, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, Quota: quota, AffCode: username + "-aff"}
		require.NoError(t, db.Create(&user).Error)
		return &user
	}
	alice := account("batch-quota-alice", common.RoleCommonUser, 1000)
	empty := account("batch-quota-empty", common.RoleCommonUser, 0)
	negative := account("batch-quota-negative", common.RoleCommonUser, 100)

	response := adminUserRequest(http.MethodPost, "/api/user/batch_quota",
		fmt.Sprintf(`{"ids":[%d,%d,%d],"direction":"add","mode":"ratio","ratio":0.5}`, alice.Id, empty.Id, negative.Id),
		"", identity, common.RoleRootUser, nil, BatchAdjustUserQuota)
	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			Succeeded int `json:"succeeded"`
			Failed    []struct {
				Id     int    `json:"id"`
				Reason string `json:"reason"`
			} `json:"failed"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &envelope), response.Body.String())
	require.True(t, envelope.Success, response.Body.String())
	assert.Equal(t, 2, envelope.Data.Succeeded)
	require.Len(t, envelope.Data.Failed, 1)
	assert.Equal(t, empty.Id, envelope.Data.Failed[0].Id)
	assert.Equal(t, batchFailureRatioTooSmall, envelope.Data.Failed[0].Reason)

	require.NoError(t, db.First(alice, alice.Id).Error)
	assert.Equal(t, 1500, alice.Quota)
	require.NoError(t, db.First(negative, negative.Id).Error)
	assert.Equal(t, 150, negative.Quota)

	// A fixed subtraction may take a balance below zero, exactly like the
	// single-user adjustment.
	response = adminUserRequest(http.MethodPost, "/api/user/batch_quota",
		fmt.Sprintf(`{"ids":[%d],"direction":"subtract","mode":"fixed","value":500}`, negative.Id),
		"", identity, common.RoleRootUser, nil, BatchAdjustUserQuota)
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &envelope), response.Body.String())
	require.True(t, envelope.Success, response.Body.String())
	require.NoError(t, db.First(negative, negative.Id).Error)
	assert.Equal(t, -350, negative.Quota)

	// Every successful adjustment keeps its own top-up log and structured audit:
	// alice was adjusted once, negative twice.
	expectedTopups := map[int]int64{alice.Id: 1, negative.Id: 2}
	for _, user := range []*model.User{alice, negative} {
		logs, total, err := model.GetUserLogs(user.Id, model.LogTypeTopup, 0, 0, "", "", 0, 20, "", "", "")
		require.NoError(t, err)
		assert.EqualValues(t, expectedTopups[user.Id], total, user.Username)
		require.NotEmpty(t, logs)
		for _, entry := range logs {
			var other model.AuditOther
			require.NoError(t, common.UnmarshalJsonStr(entry.Other, &other))
			require.NotNil(t, other.Op)
			assert.Contains(t, []string{"user.quota_add", "user.quota_subtract"}, other.Op.Action)
		}
	}

	var audits []model.AuditLog
	require.NoError(t, model.LOG_DB.Where("action IN ?", []string{"user.quota_add", "user.quota_subtract"}).Find(&audits).Error)
	assert.Len(t, audits, 3, "each successful adjustment keeps a structured audit row")
	var batchAudits []model.AuditLog
	require.NoError(t, model.LOG_DB.Where("action = ?", "user.batch_quota").Order("id asc").Find(&batchAudits).Error)
	require.Len(t, batchAudits, 2)
	require.NotNil(t, batchAudits[0].Other.Op)
	succeeded, err := common.Marshal(batchAudits[0].Other.Op.Params["succeeded"])
	require.NoError(t, err)
	assert.JSONEq(t, "2", string(succeeded))

	// Invalid parameters never reach the per-user loop.
	for _, body := range []string{
		`{"ids":[1],"direction":"add","mode":"ratio","ratio":11}`,
		`{"ids":[1],"direction":"add","mode":"ratio","ratio":0}`,
		`{"ids":[1],"direction":"add","mode":"fixed","value":0}`,
		`{"ids":[1],"direction":"remove","mode":"fixed","value":10}`,
		`{"ids":[1],"direction":"add","mode":"unknown","value":10}`,
	} {
		response = adminUserRequest(http.MethodPost, "/api/user/batch_quota", body, "", identity, common.RoleRootUser, nil, BatchAdjustUserQuota)
		assert.Contains(t, response.Body.String(), `"success":false`, body)
	}
}
