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

func setupRegistrationCodeControllerTest(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	previousType := common.MainDatabaseType()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.RegistrationCode{}, &model.Log{}))
	model.DB = db
	model.LOG_DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.SetLogDatabaseType(common.DatabaseTypeSQLite)
	previousRedis := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() {
		model.DB = previousDB
		model.LOG_DB = previousDB
		common.SetMainDatabaseType(previousType)
		common.RedisEnabled = previousRedis
	})
}

func postAddRegistrationCode(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", 1)
	c.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/registration-code/",
		strings.NewReader(body),
	)
	c.Request.Header.Set("Content-Type", "application/json")
	AddRegistrationCode(c)
	return recorder
}

func TestAddRegistrationCodeCreates(t *testing.T) {
	setupRegistrationCodeControllerTest(t)

	recorder := postAddRegistrationCode(
		t,
		`{"name":"测试注册码","count":2,"expired_time":0}`,
	)
	require.Equal(t, http.StatusOK, recorder.Code)

	var response struct {
		Success bool     `json:"success"`
		Message string   `json:"message"`
		Data    []string `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success, "message: %s", response.Message)
	require.Len(t, response.Data, 2)
	for _, key := range response.Data {
		assert.Len(t, key, 8)
	}
}

func TestAddRegistrationCodeNameLengthBoundary(t *testing.T) {
	setupRegistrationCodeControllerTest(t)

	// 名称上限 50（按 Unicode 码点计）：50 个中文字符通过，51 个被拒绝
	recorder := postAddRegistrationCode(
		t,
		`{"name":"`+strings.Repeat("码", common.MaxRedemptionNameLength)+`","count":1,"expired_time":0}`,
	)
	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success, "message: %s", response.Message)

	recorder = postAddRegistrationCode(
		t,
		`{"name":"`+strings.Repeat("码", common.MaxRedemptionNameLength+1)+`","count":1,"expired_time":0}`,
	)
	require.Equal(t, http.StatusOK, recorder.Code)
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)
	assert.Contains(t, response.Message, "1-50")
}
