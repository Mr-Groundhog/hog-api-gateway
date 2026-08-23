package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/glebarez/sqlite"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupProbeGuardControllerTestDB(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.ProbeGuardLog{}))
	model.DB = db
	t.Cleanup(func() {
		model.DB = previousDB
		_ = sqlDB.Close()
	})
}

func performProbeGuardUsersRequest(query string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/probe-guard/users"+query, nil)
	GetProbeGuardLogUsers(c)
	return recorder
}

func TestGetProbeGuardLogUsersAggregatesAndAttachesLatestModels(t *testing.T) {
	setupProbeGuardControllerTestDB(t)

	require.NoError(t, model.RecordProbeGuardLog(&model.ProbeGuardLog{
		UserId: 7, Username: "u7", Ip: "192.0.2.10", ModelsTested: `["m1","m2","m3"]`,
		DistinctCount: 3, TriggerCount: 1, ActionTaken: model.ProbeGuardActionWarning, CreatedAt: 100,
	}))
	require.NoError(t, model.RecordProbeGuardLog(&model.ProbeGuardLog{
		UserId: 7, Username: "u7", Ip: "198.51.100.23", ModelsTested: `["m9","m2"]`,
		DistinctCount: 2, TriggerCount: 2, ActionTaken: model.ProbeGuardActionBanned, CreatedAt: 200,
	}))
	require.NoError(t, model.RecordProbeGuardLog(&model.ProbeGuardLog{
		UserId: 8, Username: "u8", Ip: "203.0.113.9", ModelsTested: `["k1"]`,
		DistinctCount: 1, TriggerCount: 0, ActionTaken: model.ProbeGuardActionDryRun, CreatedAt: 300,
	}))

	recorder := performProbeGuardUsersRequest("?p=1&page_size=20")
	require.Equal(t, http.StatusOK, recorder.Code)

	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Total int               `json:"total"`
			Items []ProbeGuardLogUser `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
	require.True(t, payload.Success)
	require.Equal(t, 2, payload.Data.Total)

	itemsByUser := map[int]ProbeGuardLogUser{}
	for _, item := range payload.Data.Items {
		itemsByUser[item.UserId] = item
	}
	require.Len(t, itemsByUser, 2)

	user7 := itemsByUser[7]
	assert.Equal(t, int64(2), user7.RecordCount)
	assert.Equal(t, int64(0), user7.DryRunCount)
	assert.Equal(t, 2, user7.TriggerCount)
	assert.Equal(t, 3, user7.MaxDistinct)
	assert.Equal(t, `["m9","m2"]`, user7.LatestModels, "应附带最近一条记录（MAX(id)）的模型清单")
	assert.Equal(t, 2, user7.LatestDistinct)
	assert.Equal(t, "198.51.100.23", user7.LatestIp, "应附带最近一条记录的 IP")
	assert.Equal(t, int64(200), user7.LatestCreatedAt)

	user8 := itemsByUser[8]
	assert.Equal(t, int64(1), user8.RecordCount)
	assert.Equal(t, int64(1), user8.DryRunCount)
	assert.Equal(t, 0, user8.TriggerCount)
	assert.Equal(t, `["k1"]`, user8.LatestModels)
	assert.Equal(t, int64(300), user8.LatestCreatedAt)
}

func TestGetProbeGuardLogUsersActionFilterKeepsLatestModelsConsistent(t *testing.T) {
	setupProbeGuardControllerTestDB(t)

	require.NoError(t, model.RecordProbeGuardLog(&model.ProbeGuardLog{
		UserId: 9, Username: "u9", ModelsTested: `["a","b"]`,
		DistinctCount: 2, TriggerCount: 1, ActionTaken: model.ProbeGuardActionWarning, CreatedAt: 100,
	}))
	require.NoError(t, model.RecordProbeGuardLog(&model.ProbeGuardLog{
		UserId: 9, Username: "u9", ModelsTested: `["c","d","e","f"]`,
		DistinctCount: 4, TriggerCount: 0, ActionTaken: model.ProbeGuardActionDryRun, CreatedAt: 200,
	}))

	recorder := performProbeGuardUsersRequest("?p=1&page_size=20&action=dry_run")
	require.Equal(t, http.StatusOK, recorder.Code)

	var payload struct {
		Data struct {
			Total int                 `json:"total"`
			Items []ProbeGuardLogUser `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
	require.Equal(t, 1, payload.Data.Total)
	require.Len(t, payload.Data.Items, 1)
	assert.Equal(t, `["c","d","e","f"]`, payload.Data.Items[0].LatestModels, "筛选 dry_run 时最近记录也应来自筛选后的集合")
}
