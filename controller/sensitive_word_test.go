package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupSensitiveWordViolationTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMainDatabaseType, previousLogDatabaseType := common.MainDatabaseType(), common.LogDatabaseType()
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	db, err := gorm.Open(sqlite.Open("file:sensitive-word-violations-test?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	model.DB, model.LOG_DB = db, db
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.SensitiveWordViolation{}))
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

func performSensitiveWordCountReset(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/sensitive-word-violations/reset-count", strings.NewReader(body))
	ResetSensitiveWordViolationCount(c)
	return recorder
}

func performSensitiveWordViolationRequest(t *testing.T, path string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, path, nil)
	GetSensitiveWordViolations(c)
	return recorder
}

func TestGetSensitiveWordViolationsFiltersByKeywordAndDate(t *testing.T) {
	db := setupSensitiveWordViolationTestDB(t)
	require.NoError(t, db.Create(&model.SensitiveWordViolation{
		UserId: 7, Username: "alice", Ip: "192.0.2.10", MatchedWords: `["secret"]`,
		RequestContent: "contains secret", CreatedAt: 100,
	}).Error)
	require.NoError(t, db.Create(&model.SensitiveWordViolation{
		UserId: 8, Username: "bob", Ip: "192.0.2.11", MatchedWords: `["blocked"]`,
		RequestContent: "contains blocked", CreatedAt: 200,
	}).Error)

	recorder := performSensitiveWordViolationRequest(t, "/api/sensitive-word-violations?keyword=secret&start_time=100&end_time=100")
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"total":1`)
	assert.Contains(t, recorder.Body.String(), `"username":"alice"`)
	assert.NotContains(t, recorder.Body.String(), `"username":"bob"`)
}

func TestGetSensitiveWordViolationsKeywordMatchesUserID(t *testing.T) {
	db := setupSensitiveWordViolationTestDB(t)
	require.NoError(t, db.Create(&model.SensitiveWordViolation{
		UserId: 42, Username: "numeric-user", MatchedWords: "[]", RequestContent: "blocked", CreatedAt: 100,
	}).Error)

	recorder := performSensitiveWordViolationRequest(t, "/api/sensitive-word-violations?keyword=42")
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"total":1`)
	assert.Contains(t, recorder.Body.String(), `"user_id":42`)
}

func TestGetSensitiveWordViolationsHighlightsAtFiveTriggers(t *testing.T) {
	db := setupSensitiveWordViolationTestDB(t)
	require.NoError(t, db.Create(&model.SensitiveWordViolation{
		UserId: 4, Username: "four", TriggerCount: 4, Highlighted: true, CreatedAt: 100,
	}).Error)
	require.NoError(t, db.Create(&model.SensitiveWordViolation{
		UserId: 5, Username: "five", TriggerCount: 5, Highlighted: false, CreatedAt: 200,
	}).Error)

	recorder := performSensitiveWordViolationRequest(t, "/api/sensitive-word-violations")
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"username":"five"`)
	assert.Contains(t, recorder.Body.String(), `"trigger_count":5,"highlighted":true`)
	assert.Contains(t, recorder.Body.String(), `"username":"four"`)
	assert.Contains(t, recorder.Body.String(), `"trigger_count":4,"highlighted":false`)
}

func TestResetSensitiveWordViolationCountClearsUserAndRecords(t *testing.T) {
	db := setupSensitiveWordViolationTestDB(t)
	require.NoError(t, db.Create(&model.User{
		Id: 7, Username: "alice", Password: "password", SensitiveWordTriggerCount: 7,
	}).Error)
	require.NoError(t, db.Create(&model.SensitiveWordViolation{
		UserId: 7, Username: "alice", TriggerCount: 7, Highlighted: true, CreatedAt: 100,
	}).Error)

	recorder := performSensitiveWordCountReset(t, `{"user_id":7}`)
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"success":true`)

	var user model.User
	require.NoError(t, db.First(&user, 7).Error)
	assert.Zero(t, user.SensitiveWordTriggerCount)
	var violation model.SensitiveWordViolation
	require.NoError(t, db.Where("user_id = ?", 7).First(&violation).Error)
	assert.Zero(t, violation.TriggerCount)
	assert.False(t, violation.Highlighted)
}

func setupAIReviewControllerTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMainDatabaseType, previousLogDatabaseType := common.MainDatabaseType(), common.LogDatabaseType()
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	db, err := gorm.Open(sqlite.Open("file:ai-review-controller-test?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	model.DB, model.LOG_DB = db, db
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.AIReviewRecord{}))
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

func performAIReviewHandle(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/ai-review/handle", strings.NewReader(body))
	c.Set("id", 1)
	c.Set("username", "admin")
	HandleAIReviewRecord(c)
	return recorder
}

func TestHandleAIReviewRecordConfirmAndDismiss(t *testing.T) {
	db := setupAIReviewControllerTestDB(t)
	require.NoError(t, db.Create(&model.AIReviewRecord{
		Id: 11, UserId: 7, Username: "alice", Verdict: model.AIReviewVerdictFlagged,
		AdminStatus: model.AIReviewStatusPending, CreatedAt: 100,
	}).Error)
	require.NoError(t, db.Create(&model.AIReviewRecord{
		Id: 12, UserId: 7, Username: "alice", Verdict: model.AIReviewVerdictFlagged,
		AdminStatus: model.AIReviewStatusPending, CreatedAt: 101,
	}).Error)

	recorder := performAIReviewHandle(t, `{"id":11,"action":"dismiss","comment":"false positive from word list"}`)
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"success":true`)

	recorder = performAIReviewHandle(t, `{"id":12,"action":"confirm"}`)
	assert.Equal(t, http.StatusOK, recorder.Code)

	var dismissed, confirmed model.AIReviewRecord
	require.NoError(t, db.First(&dismissed, 11).Error)
	assert.Equal(t, model.AIReviewStatusDismissed, dismissed.AdminStatus)
	assert.Equal(t, "false positive from word list", dismissed.AdminComment)
	assert.Equal(t, "admin", dismissed.AdminUsername)
	assert.Equal(t, 1, dismissed.AdminId)
	assert.Positive(t, dismissed.HandledAt)
	require.NoError(t, db.First(&confirmed, 12).Error)
	assert.Equal(t, model.AIReviewStatusConfirmed, confirmed.AdminStatus)
	assert.Equal(t, "none", confirmed.ActionTaken)

	recorder = performAIReviewHandle(t, `{"id":12,"action":"explode"}`)
	assert.Equal(t, http.StatusBadRequest, recorder.Code)
}
