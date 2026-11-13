package controller

import (
	"errors"
	"maps"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/QuantumNous/new-api/setting/operation_setting"
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

func setupRegistrationRewardsTest(t *testing.T) (*gorm.DB, *model.User) {
	t.Helper()
	db, dialect := openTaskDialectDatabase(t, &model.User{}, &model.Log{}, &model.RegistrationCode{},
		&model.UserOAuthBinding{}, &model.CustomOAuthProvider{}, &model.TwoFA{}, &model.TwoFABackupCode{},
		&model.PasskeyCredential{}, &model.UserSession{}, &model.AuthFlow{}, &model.UserAccessToken{},
		&model.ExternalIdentityClaim{}, &model.Token{})
	oldDB, oldLogDB := model.DB, model.LOG_DB
	oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
	oldRedis, oldMemory, oldBatch := common.RedisEnabled, common.MemoryCacheEnabled, common.BatchUpdateEnabled
	oldRegister, oldPassword, oldEmail, oldCode := common.RegisterEnabled, common.PasswordRegisterEnabled, common.EmailVerificationEnabled, common.RegistrationCodeEnabled
	oldNew, oldInvitee, oldInviter := common.QuotaForNewUser, common.QuotaForInvitee, common.QuotaForInviter
	oldDefaultToken := constant.GenerateDefaultToken
	payment := operation_setting.GetPaymentSetting()
	oldPayment := *payment
	model.DB, model.LOG_DB = db, db
	common.SetDatabaseTypes(dialect, dialect)
	common.RedisEnabled, common.MemoryCacheEnabled, common.BatchUpdateEnabled = false, false, false
	common.RegisterEnabled, common.PasswordRegisterEnabled, common.EmailVerificationEnabled, common.RegistrationCodeEnabled = true, true, false, true
	common.QuotaForNewUser, common.QuotaForInvitee, common.QuotaForInviter = 50, 25, 100
	constant.GenerateDefaultToken = false
	payment.ComplianceConfirmed, payment.ComplianceTermsVersion = true, operation_setting.CurrentComplianceTermsVersion
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SetDatabaseTypes(oldMain, oldLog)
		common.RedisEnabled, common.MemoryCacheEnabled, common.BatchUpdateEnabled = oldRedis, oldMemory, oldBatch
		common.RegisterEnabled, common.PasswordRegisterEnabled, common.EmailVerificationEnabled, common.RegistrationCodeEnabled = oldRegister, oldPassword, oldEmail, oldCode
		common.QuotaForNewUser, common.QuotaForInvitee, common.QuotaForInviter = oldNew, oldInvitee, oldInviter
		constant.GenerateDefaultToken = oldDefaultToken
		*payment = oldPayment
	})
	inviter := &model.User{Username: "inviter", AffCode: "valid-aff", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1}
	require.NoError(t, db.Create(inviter).Error)
	return db, inviter
}

func registerWithCode(t *testing.T, provider oauth.Provider, username, code string) bool {
	t.Helper()
	body, err := common.Marshal(map[string]string{
		"username": username, "password": "registration-test-password", "aff_code": "valid-aff", "registration_code": code,
	})
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/user/register", strings.NewReader(string(body)))
	if provider != nil {
		user, _, err := findOrCreateOAuthUser(ctx, provider, &oauth.OAuthUser{ProviderUserID: username, Username: username}, &oauth.OAuthToken{}, "valid-aff", code)
		return err == nil && user != nil
	}
	Register(ctx)
	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	return response.Success
}

func TestRegistrationCodeRejectsWithoutSideEffects(t *testing.T) {
	for _, kind := range []string{"builtin", "custom", "password"} {
		for _, state := range []string{"used", "expired", "disabled", "unknown", "empty"} {
			t.Run(kind+"/"+state, func(t *testing.T) {
				db, inviter := setupRegistrationRewardsTest(t)
				var provider oauth.Provider
				switch kind {
				case "builtin":
					provider = &oauth.GitHubProvider{}
				case "custom":
					config := &model.CustomOAuthProvider{Name: "Test", Slug: "test-custom", Enabled: true}
					require.NoError(t, db.Create(config).Error)
					provider = oauth.NewGenericOAuthProvider(config)
				}
				key := "used1234"
				if state == "empty" {
					key = ""
				} else if state != "unknown" {
					code := model.RegistrationCode{Key: key, Name: "test", Status: common.RedemptionCodeStatusUsed, UsedUserId: inviter.Id, UsedUsername: inviter.Username}
					if state == "expired" {
						code.Status, code.ExpiredTime = common.RedemptionCodeStatusEnabled, common.GetTimestamp()-60
					} else if state == "disabled" {
						code.Status = common.RedemptionCodeStatusDisabled
					}
					require.NoError(t, db.Create(&code).Error)
				}
				for range 2 {
					assert.False(t, registerWithCode(t, provider, "rejected-user", key))
					var users, bindings, logs int64
					require.NoError(t, db.Unscoped().Model(&model.User{}).Where("id <> ?", inviter.Id).Count(&users).Error)
					require.NoError(t, db.Model(&model.UserOAuthBinding{}).Count(&bindings).Error)
					require.NoError(t, db.Model(&model.Log{}).Count(&logs).Error)
					assert.Zero(t, users, "failed registration must not create a user")
					assert.Zero(t, bindings, "failed registration must not bind an OAuth identity")
					assert.Zero(t, logs, "failed registration must not emit success or reward logs")
					require.NoError(t, db.First(inviter, inviter.Id).Error)
					assert.Zero(t, inviter.AffQuota)
					assert.Zero(t, inviter.AffHistoryQuota)
					assert.Zero(t, inviter.AffCount)
				}
			})
		}
	}
}

func TestRegistrationDisabledRejectsWithoutSideEffects(t *testing.T) {
	for _, kind := range []string{"builtin", "custom", "password"} {
		for _, requireCode := range []bool{false, true} {
			name := kind + "/without-code"
			if requireCode {
				name = kind + "/with-code"
			}
			t.Run(name, func(t *testing.T) {
				db, inviter := setupRegistrationRewardsTest(t)
				common.RegisterEnabled, common.RegistrationCodeEnabled = false, requireCode
				var provider oauth.Provider
				if kind == "builtin" {
					provider = &oauth.GitHubProvider{}
				} else if kind == "custom" {
					config := &model.CustomOAuthProvider{Name: "Test", Slug: "test-custom", Enabled: true}
					require.NoError(t, db.Create(config).Error)
					provider = oauth.NewGenericOAuthProvider(config)
				}
				code := model.RegistrationCode{Key: "closed1234", Name: "test", Status: common.RedemptionCodeStatusEnabled}
				require.NoError(t, db.Create(&code).Error)
				key := ""
				if requireCode {
					key = code.Key
				}
				for range 2 {
					assert.False(t, registerWithCode(t, provider, "closed-user", key))
				}
				var users, bindings, logs int64
				require.NoError(t, db.Unscoped().Model(&model.User{}).Where("id <> ?", inviter.Id).Count(&users).Error)
				require.NoError(t, db.Model(&model.UserOAuthBinding{}).Count(&bindings).Error)
				require.NoError(t, db.Model(&model.Log{}).Count(&logs).Error)
				assert.Zero(t, users)
				assert.Zero(t, bindings)
				assert.Zero(t, logs)
				require.NoError(t, db.First(inviter, inviter.Id).Error)
				assert.Zero(t, inviter.AffQuota)
				assert.Zero(t, inviter.AffHistoryQuota)
				assert.Zero(t, inviter.AffCount)
				require.NoError(t, db.First(&code, code.Id).Error)
				assert.Equal(t, common.RedemptionCodeStatusEnabled, code.Status)
			})
		}
	}
}

func TestRegistrationSwitchPersistence(t *testing.T) {
	for _, failurePhase := range []string{"query", "update", "none"} {
		t.Run(failurePhase, func(t *testing.T) {
			db, _ := setupRegistrationRewardsTest(t)
			require.NoError(t, db.AutoMigrate(&model.Option{}, &model.SystemTask{}))
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&model.Option{}, &model.SystemTask{})) })
			common.OptionMapRWMutex.Lock()
			previousOptions := maps.Clone(common.OptionMap)
			common.OptionMapRWMutex.Unlock()
			t.Cleanup(func() {
				common.OptionMapRWMutex.Lock()
				common.OptionMap = previousOptions
				common.OptionMapRWMutex.Unlock()
			})
			require.NoError(t, model.UpdateOption("RegisterEnabled", "true"))
			var revisionsBefore int64
			require.NoError(t, db.Model(&model.SystemTask{}).Count(&revisionsBefore).Error)
			failWrite := func(tx *gorm.DB) {
				if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "Option" {
					tx.AddError(errors.New("settings persistence unavailable"))
				}
			}
			switch failurePhase {
			case "query":
				require.NoError(t, db.Callback().Query().Before("gorm:query").Register("test:option_failure", failWrite))
			case "update":
				require.NoError(t, db.Callback().Update().Before("gorm:update").Register("test:option_failure", failWrite))
			}
			err := model.UpdateOption("RegisterEnabled", "false")
			switch failurePhase {
			case "query":
				require.NoError(t, db.Callback().Query().Remove("test:option_failure"))
			case "update":
				require.NoError(t, db.Callback().Update().Remove("test:option_failure"))
			}
			var option model.Option
			require.NoError(t, db.Where("key = ?", "RegisterEnabled").First(&option).Error)
			var revisions int64
			require.NoError(t, db.Model(&model.SystemTask{}).Count(&revisions).Error)
			if failurePhase == "none" {
				require.NoError(t, err)
				assert.False(t, common.RegisterEnabled)
				assert.Equal(t, "false", option.Value)
				assert.Equal(t, revisionsBefore+1, revisions)
				require.NoError(t, model.LoadOptionsFromDatabase())
				assert.False(t, common.RegisterEnabled, "a successful closure survives settings reload")
			} else {
				assert.Error(t, err, "settings save failures must not be reported as success")
				assert.True(t, common.RegisterEnabled, "runtime settings must not diverge from the database after failure")
				assert.Equal(t, "true", option.Value)
				assert.Equal(t, revisionsBefore, revisions)
				require.NoError(t, model.LoadOptionsFromDatabase())
				assert.True(t, common.RegisterEnabled)
			}
		})
	}
}

func TestRegistrationCodeAwardsOnlyOneRegistration(t *testing.T) {
	for _, kind := range []string{"builtin", "custom", "password"} {
		t.Run(kind, func(t *testing.T) {
			db, inviter := setupRegistrationRewardsTest(t)
			var provider oauth.Provider
			if kind == "builtin" {
				provider = &oauth.GitHubProvider{}
			} else if kind == "custom" {
				config := &model.CustomOAuthProvider{Name: "Test", Slug: "test-custom", Enabled: true}
				require.NoError(t, db.Create(config).Error)
				provider = oauth.NewGenericOAuthProvider(config)
			}
			code := model.RegistrationCode{Key: "valid123", Name: "test", Status: common.RedemptionCodeStatusEnabled}
			require.NoError(t, db.Create(&code).Error)
			require.True(t, registerWithCode(t, provider, "accepted-user", code.Key))
			assert.False(t, registerWithCode(t, provider, "second-user", code.Key))
			if provider != nil {
				assert.True(t, registerWithCode(t, provider, "accepted-user", ""), "existing OAuth login does not require or consume another code")
			}
			var user model.User
			require.NoError(t, db.Where("username = ?", "accepted-user").First(&user).Error)
			assert.Equal(t, 75, user.Quota)
			assert.Equal(t, inviter.Id, user.InviterId)
			require.NoError(t, db.First(&code, code.Id).Error)
			assert.Equal(t, common.RedemptionCodeStatusUsed, code.Status)
			assert.Equal(t, user.Id, code.UsedUserId)
			assert.Equal(t, user.Username, code.UsedUsername)
			require.NoError(t, db.First(inviter, inviter.Id).Error)
			assert.Equal(t, 100, inviter.AffQuota)
			assert.Equal(t, 100, inviter.AffHistoryQuota)
			assert.Equal(t, 1, inviter.AffCount)
			var logs int64
			require.NoError(t, db.Model(&model.Log{}).Count(&logs).Error)
			assert.EqualValues(t, 3, logs)
		})
	}
}

func TestRegistrationCodeConcurrentOAuthRegistrationAwardsOnce(t *testing.T) {
	db, inviter := setupRegistrationRewardsTest(t)
	code := model.RegistrationCode{Key: "valid123", Name: "test", Status: common.RedemptionCodeStatusEnabled}
	require.NoError(t, db.Create(&code).Error)
	start := make(chan struct{})
	results := make(chan bool, 2)
	var workers sync.WaitGroup
	for _, username := range []string{"concurrent-a", "concurrent-b"} {
		workers.Go(func() {
			<-start
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest(http.MethodGet, "/api/oauth/github", nil)
			user, _, err := findOrCreateOAuthUser(ctx, &oauth.GitHubProvider{}, &oauth.OAuthUser{ProviderUserID: username, Username: username}, &oauth.OAuthToken{}, "valid-aff", code.Key)
			results <- err == nil && user != nil
		})
	}
	close(start)
	workers.Wait()
	close(results)
	successes := 0
	for success := range results {
		if success {
			successes++
		}
	}
	assert.Equal(t, 1, successes)
	var users int64
	require.NoError(t, db.Model(&model.User{}).Where("id <> ?", inviter.Id).Count(&users).Error)
	assert.EqualValues(t, 1, users)
	require.NoError(t, db.First(inviter, inviter.Id).Error)
	assert.Equal(t, 100, inviter.AffQuota)
	assert.Equal(t, 1, inviter.AffCount)
}

func TestRegistrationTransactionRollsBackCodeAndRewards(t *testing.T) {
	db, inviter := setupRegistrationRewardsTest(t)
	code := model.RegistrationCode{Key: "valid123", Name: "test", Status: common.RedemptionCodeStatusEnabled}
	require.NoError(t, db.Create(&code).Error)
	user := &model.User{Username: "rolled-back-user", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
	failure := errors.New("registration transaction failed")
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := user.InsertWithTx(tx, inviter.Id); err != nil {
			return err
		}
		if _, err := model.ConsumeRegistrationCodeWithTx(tx, code.Key, user.Id, user.Username); err != nil {
			return err
		}
		return failure
	})
	require.ErrorIs(t, err, failure)
	var users int64
	require.NoError(t, db.Unscoped().Model(&model.User{}).Where("id <> ?", inviter.Id).Count(&users).Error)
	assert.Zero(t, users)
	require.NoError(t, db.First(&code, code.Id).Error)
	assert.Equal(t, common.RedemptionCodeStatusEnabled, code.Status)
	assert.Zero(t, code.UsedUserId)
	assert.Empty(t, code.UsedUsername)
	require.NoError(t, db.First(inviter, inviter.Id).Error)
	assert.Zero(t, inviter.AffQuota)
	assert.Zero(t, inviter.AffCount)
	assert.True(t, registerWithCode(t, &oauth.GitHubProvider{}, "retry-user", code.Key))
}

func TestRegistrationRewardLimitFailsWithoutConsumingCode(t *testing.T) {
	for _, overflow := range []string{"inviter", "invitee"} {
		t.Run(overflow, func(t *testing.T) {
			db, inviter := setupRegistrationRewardsTest(t)
			if overflow == "inviter" {
				require.NoError(t, db.Model(inviter).Update("aff_quota", common.MaxWalletQuota).Error)
			} else {
				common.QuotaForInvitee = common.MaxWalletQuota
			}
			code := model.RegistrationCode{Key: "valid123", Name: "test", Status: common.RedemptionCodeStatusEnabled}
			require.NoError(t, db.Create(&code).Error)
			assert.False(t, registerWithCode(t, &oauth.GitHubProvider{}, "overflow-user", code.Key))
			var users, logs int64
			require.NoError(t, db.Unscoped().Model(&model.User{}).Where("id <> ?", inviter.Id).Count(&users).Error)
			require.NoError(t, db.Model(&model.Log{}).Count(&logs).Error)
			assert.Zero(t, users)
			assert.Zero(t, logs)
			require.NoError(t, db.First(&code, code.Id).Error)
			assert.Equal(t, common.RedemptionCodeStatusEnabled, code.Status)
			assert.Zero(t, code.UsedUserId)
		})
	}
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
