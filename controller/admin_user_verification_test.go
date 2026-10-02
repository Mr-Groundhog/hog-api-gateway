package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setupAdminUserTest promotes the enrolled operator to root and creates a
// managed common user for the administrative endpoints to act on.
func setupAdminUserTest(t *testing.T) (*model.User, service.AuthIdentity, *model.User) {
	t.Helper()
	operator, identity := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.Model(operator).Update("role", common.RoleRootUser).Error)
	require.NoError(t, model.PublishUserAuthCache(operator.Id))
	password, err := common.Password2Hash("managed-password")
	require.NoError(t, err)
	target := &model.User{Username: "managed-user", Password: password, Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "managed-aff", GitHubId: "managed-github"}
	require.NoError(t, model.DB.Create(target).Error)
	return operator, identity, target
}

// setupNonRootAdminTest gives the enrolled operator the ordinary admin role so
// the root exemption does not apply to it.
func setupNonRootAdminTest(t *testing.T) (*model.User, service.AuthIdentity, *model.User) {
	t.Helper()
	operator, identity, target := setupAdminUserTest(t)
	require.NoError(t, model.DB.Model(operator).Update("role", common.RoleAdminUser).Error)
	require.NoError(t, model.PublishUserAuthCache(operator.Id))
	return operator, identity, target
}

// adminUserRequest drives an admin user-management handler with the operator
// context that AdminAuth would have populated for a dashboard session.
func adminUserRequest(method, path, body, proof string, identity service.AuthIdentity, role int, params gin.Params, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest(method, path, strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if proof != "" {
		c.Request.Header.Set("X-Security-Proof", proof)
	}
	c.Params = params
	c.Set("id", identity.UserID)
	c.Set("username", "enrollment-user")
	c.Set("role", role)
	c.Set("session_id", identity.SessionID)
	c.Set("auth_version", identity.UserAuthVersion)
	c.Set("session_version", identity.SessionVersion)
	handler(c)
	return response
}

func TestAdminUserRiskOperationsRequireProofBeforeMutation(t *testing.T) {
	for _, test := range []struct {
		name, method, path string
		body               func(target *model.User) string
		params             func(target *model.User) gin.Params
		handler            gin.HandlerFunc
		// operatorRole is the role that owns the operation when the root
		// exemption does not apply. Root skips proof for ban, enable and
		// delete, so those cases exercise an ordinary admin instead.
		operatorRole int
		unchanged    func(t *testing.T, target *model.User)
	}{
		{
			name: "hard delete", method: http.MethodDelete, path: "/api/user/:id", handler: DeleteUser, operatorRole: common.RoleAdminUser,
			params: func(target *model.User) gin.Params { return gin.Params{{Key: "id", Value: fmt.Sprint(target.Id)}} },
			unchanged: func(t *testing.T, target *model.User) {
				_, err := model.GetUserById(target.Id, false)
				assert.NoError(t, err)
			},
		},
		{
			name: "manage disable", method: http.MethodPost, path: "/api/user/manage", handler: ManageUser, operatorRole: common.RoleAdminUser,
			body: func(target *model.User) string { return fmt.Sprintf(`{"id":%d,"action":"disable"}`, target.Id) },
			unchanged: func(t *testing.T, target *model.User) {
				stored, err := model.GetUserById(target.Id, false)
				require.NoError(t, err)
				assert.Equal(t, common.UserStatusEnabled, stored.Status)
			},
		},
		{
			name: "manage promote", method: http.MethodPost, path: "/api/user/manage", handler: ManageUser,
			body: func(target *model.User) string { return fmt.Sprintf(`{"id":%d,"action":"promote"}`, target.Id) },
			unchanged: func(t *testing.T, target *model.User) {
				stored, err := model.GetUserById(target.Id, false)
				require.NoError(t, err)
				assert.Equal(t, common.RoleCommonUser, stored.Role)
			},
		},
		{
			name: "manage delete", method: http.MethodPost, path: "/api/user/manage", handler: ManageUser, operatorRole: common.RoleAdminUser,
			body: func(target *model.User) string { return fmt.Sprintf(`{"id":%d,"action":"delete"}`, target.Id) },
			unchanged: func(t *testing.T, target *model.User) {
				_, err := model.GetUserById(target.Id, false)
				assert.NoError(t, err)
			},
		},
		{
			name: "password reset", method: http.MethodPut, path: "/api/user/", handler: UpdateUser,
			body: func(target *model.User) string {
				return fmt.Sprintf(`{"id":%d,"username":"managed-user","display_name":"Managed","password":"replacement-pass"}`, target.Id)
			},
			unchanged: func(t *testing.T, target *model.User) {
				stored, err := model.GetUserById(target.Id, true)
				require.NoError(t, err)
				assert.True(t, common.ValidatePasswordAndHash("managed-password", stored.Password))
			},
		},
		{
			name: "admin permission matrix", method: http.MethodPut, path: "/api/user/", handler: UpdateUser,
			body: func(target *model.User) string {
				return fmt.Sprintf(`{"id":%d,"username":"managed-user","display_name":"Managed","admin_permissions":{}}`, target.Id)
			},
			unchanged: func(t *testing.T, target *model.User) {
				stored, err := model.GetUserById(target.Id, false)
				require.NoError(t, err)
				assert.Equal(t, "", stored.DisplayName)
			},
		},
		{
			name: "create administrator", method: http.MethodPost, path: "/api/user/", handler: CreateUser,
			body: func(*model.User) string { return `{"username":"new-admin","password":"admin-password-1","role":10}` },
			unchanged: func(t *testing.T, _ *model.User) {
				var count int64
				require.NoError(t, model.DB.Model(&model.User{}).Where("username = ?", "new-admin").Count(&count).Error)
				assert.Zero(t, count)
			},
		},
		{
			name: "batch ban by condition", method: http.MethodPost, path: "/api/user/ban_by_condition", handler: BanUserByCondition, operatorRole: common.RoleAdminUser,
			body: func(*model.User) string { return `{"mode":"last_call","before":1}` },
			unchanged: func(t *testing.T, target *model.User) {
				stored, err := model.GetUserById(target.Id, false)
				require.NoError(t, err)
				assert.Equal(t, common.UserStatusEnabled, stored.Status)
			},
		},
		{
			name: "batch ban by ids", method: http.MethodPost, path: "/api/user/ban_by_ids", handler: BanUsersByIds, operatorRole: common.RoleAdminUser,
			body: func(target *model.User) string { return fmt.Sprintf(`{"ids":[%d]}`, target.Id) },
			unchanged: func(t *testing.T, target *model.User) {
				stored, err := model.GetUserById(target.Id, false)
				require.NoError(t, err)
				assert.Equal(t, common.UserStatusEnabled, stored.Status)
			},
		},
		{
			name: "passkey reset", method: http.MethodDelete, path: "/api/user/:id/reset_passkey", handler: AdminResetPasskey,
			params: func(target *model.User) gin.Params { return gin.Params{{Key: "id", Value: fmt.Sprint(target.Id)}} },
			unchanged: func(t *testing.T, target *model.User) {
				_, err := model.GetPasskeyByUserID(target.Id)
				assert.NoError(t, err)
			},
		},
		{
			name: "two-factor disable", method: http.MethodDelete, path: "/api/user/:id/2fa", handler: AdminDisable2FA,
			params: func(target *model.User) gin.Params { return gin.Params{{Key: "id", Value: fmt.Sprint(target.Id)}} },
			unchanged: func(t *testing.T, target *model.User) {
				twoFA, err := model.GetTwoFAByUserId(target.Id)
				require.NoError(t, err)
				assert.True(t, twoFA.IsEnabled)
			},
		},
		{
			name: "built-in binding clear", method: http.MethodDelete, path: "/api/user/:id/bindings/:binding_type", handler: AdminClearUserBinding,
			params: func(target *model.User) gin.Params {
				return gin.Params{{Key: "id", Value: fmt.Sprint(target.Id)}, {Key: "binding_type", Value: "github"}}
			},
			unchanged: func(t *testing.T, target *model.User) {
				stored, err := model.GetUserById(target.Id, false)
				require.NoError(t, err)
				assert.Equal(t, "managed-github", stored.GitHubId)
			},
		},
		{
			name: "custom oauth unbind", method: http.MethodDelete, path: "/api/user/:id/oauth/bindings/:provider_id", handler: UnbindCustomOAuthByAdmin,
			params: func(target *model.User) gin.Params {
				return gin.Params{{Key: "id", Value: fmt.Sprint(target.Id)}, {Key: "provider_id", Value: "7"}}
			},
			unchanged: func(t *testing.T, target *model.User) {
				bindings, err := model.GetUserOAuthBindingsByUserId(target.Id)
				require.NoError(t, err)
				assert.Len(t, bindings, 1)
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, identity, target := setupAdminUserTest(t)
			require.NoError(t, model.DB.Create(&model.PasskeyCredential{UserID: target.Id, CredentialID: "managed-passkey", PublicKey: "public-key"}).Error)
			require.NoError(t, model.DB.Create(&model.TwoFA{UserId: target.Id, Secret: "JBSWY3DPEHPK3PXP", IsEnabled: true}).Error)
			require.NoError(t, model.DB.Create(&model.UserOAuthBinding{UserId: target.Id, ProviderId: 7, ProviderUserId: "provider-user"}).Error)
			role := test.operatorRole
			if role == 0 {
				role = common.RoleRootUser
			}
			var body string
			if test.body != nil {
				body = test.body(target)
			}
			var params gin.Params
			if test.params != nil {
				params = test.params(target)
			}
			response := adminUserRequest(test.method, test.path, body, "", identity, role, params, test.handler)
			var result securityEnrollmentResponse
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.Equal(t, http.StatusForbidden, response.Code)
			assert.Equal(t, "SECURITY_PROOF_REQUIRED", result.Code)
			test.unchanged(t, target)
			var flows int64
			require.NoError(t, model.DB.Model(&model.AuthFlow{}).Count(&flows).Error)
			assert.Zero(t, flows)
		})
	}
}

// Root skips step-up verification for ban, enable and delete, but not for
// role changes and the other administrative actions.
func TestRootSkipsProofForBanEnableAndDelete(t *testing.T) {
	t.Run("manage disable records root_exempt", func(t *testing.T) {
		_, identity, target := setupAdminUserTest(t)
		response := adminUserRequest(http.MethodPost, "/api/user/manage",
			fmt.Sprintf(`{"id":%d,"action":"disable","ban_reason":"batch_activity_check"}`, target.Id),
			"", identity, common.RoleRootUser, nil, ManageUser)
		var result securityEnrollmentResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		stored, err := model.GetUserById(target.Id, false)
		require.NoError(t, err)
		assert.Equal(t, common.UserStatusDisabled, stored.Status)
		var audit model.AuditLog
		require.NoError(t, model.LOG_DB.Where("action = ?", "user.manage").Last(&audit).Error)
		require.NotNil(t, audit.Other.Op)
		verificationMethod, err := common.Marshal(audit.Other.Op.Params["verification_method"])
		require.NoError(t, err)
		assert.JSONEq(t, `"root_exempt"`, string(verificationMethod))
	})

	t.Run("manage enable records root_exempt", func(t *testing.T) {
		_, identity, target := setupAdminUserTest(t)
		require.NoError(t, model.DB.Model(target).Update("status", common.UserStatusDisabled).Error)
		response := adminUserRequest(http.MethodPost, "/api/user/manage",
			fmt.Sprintf(`{"id":%d,"action":"enable"}`, target.Id),
			"", identity, common.RoleRootUser, nil, ManageUser)
		var result securityEnrollmentResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		stored, err := model.GetUserById(target.Id, false)
		require.NoError(t, err)
		assert.Equal(t, common.UserStatusEnabled, stored.Status)
		var audit model.AuditLog
		require.NoError(t, model.LOG_DB.Where("action = ?", "user.manage").Last(&audit).Error)
		require.NotNil(t, audit.Other.Op)
		verificationMethod, err := common.Marshal(audit.Other.Op.Params["verification_method"])
		require.NoError(t, err)
		assert.JSONEq(t, `"root_exempt"`, string(verificationMethod))
	})

	t.Run("hard delete", func(t *testing.T) {
		_, identity, target := setupAdminUserTest(t)
		response := adminUserRequest(http.MethodDelete, "/api/user/:id", "", "", identity, common.RoleRootUser,
			gin.Params{{Key: "id", Value: fmt.Sprint(target.Id)}}, DeleteUser)
		var result securityEnrollmentResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		_, err := model.GetUserById(target.Id, false)
		assert.Error(t, err)
	})

	t.Run("manage delete", func(t *testing.T) {
		_, identity, target := setupAdminUserTest(t)
		response := adminUserRequest(http.MethodPost, "/api/user/manage",
			fmt.Sprintf(`{"id":%d,"action":"delete"}`, target.Id),
			"", identity, common.RoleRootUser, nil, ManageUser)
		var result securityEnrollmentResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		_, err := model.GetUserById(target.Id, false)
		assert.Error(t, err)
	})

	t.Run("conditional ban writes structured audit", func(t *testing.T) {
		_, identity, target := setupAdminUserTest(t)
		response := adminUserRequest(http.MethodPost, "/api/user/ban_by_condition",
			`{"mode":"last_call","before":1}`, "", identity, common.RoleRootUser, nil, BanUserByCondition)
		var result securityEnrollmentResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		stored, err := model.GetUserById(target.Id, false)
		require.NoError(t, err)
		assert.Equal(t, common.UserStatusDisabled, stored.Status)
		var audit model.AuditLog
		require.NoError(t, model.LOG_DB.Where("action = ?", "user.ban_by_condition").Last(&audit).Error)
		require.NotNil(t, audit.Other.Op)
		verificationMethod, err := common.Marshal(audit.Other.Op.Params["verification_method"])
		require.NoError(t, err)
		assert.JSONEq(t, `"root_exempt"`, string(verificationMethod))
		bannedCount, err := common.Marshal(audit.Other.Op.Params["banned"])
		require.NoError(t, err)
		assert.JSONEq(t, `1`, string(bannedCount))
	})

	t.Run("ban by ids", func(t *testing.T) {
		_, identity, target := setupAdminUserTest(t)
		response := adminUserRequest(http.MethodPost, "/api/user/ban_by_ids",
			fmt.Sprintf(`{"ids":[%d],"ban_reason":"batch_activity_check"}`, target.Id),
			"", identity, common.RoleRootUser, nil, BanUsersByIds)
		var result securityEnrollmentResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		stored, err := model.GetUserById(target.Id, false)
		require.NoError(t, err)
		assert.Equal(t, common.UserStatusDisabled, stored.Status)
		var audit model.AuditLog
		require.NoError(t, model.LOG_DB.Where("action = ?", "user.ban_by_ids").Last(&audit).Error)
		require.NotNil(t, audit.Other.Op)
		verificationMethod, err := common.Marshal(audit.Other.Op.Params["verification_method"])
		require.NoError(t, err)
		assert.JSONEq(t, `"root_exempt"`, string(verificationMethod))
	})

	t.Run("enable still requires proof for a non-root admin", func(t *testing.T) {
		_, identity, target := setupNonRootAdminTest(t)
		require.NoError(t, model.DB.Model(target).Update("status", common.UserStatusDisabled).Error)
		response := adminUserRequest(http.MethodPost, "/api/user/manage",
			fmt.Sprintf(`{"id":%d,"action":"enable"}`, target.Id),
			"", identity, common.RoleAdminUser, nil, ManageUser)
		var result securityEnrollmentResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		assert.Equal(t, http.StatusForbidden, response.Code)
		assert.Equal(t, "SECURITY_PROOF_REQUIRED", result.Code)
		stored, err := model.GetUserById(target.Id, false)
		require.NoError(t, err)
		assert.Equal(t, common.UserStatusDisabled, stored.Status)
	})

	t.Run("promote and demote still require proof", func(t *testing.T) {
		for _, action := range []string{"promote", "demote"} {
			t.Run(action, func(t *testing.T) {
				_, identity, target := setupAdminUserTest(t)
				// Demote needs a promotable target; role changes always require
				// proof regardless of the target state.
				if action == "demote" {
					require.NoError(t, model.DB.Model(target).Update("role", common.RoleAdminUser).Error)
				}
				response := adminUserRequest(http.MethodPost, "/api/user/manage",
					fmt.Sprintf(`{"id":%d,"action":%q}`, target.Id, action),
					"", identity, common.RoleRootUser, nil, ManageUser)
				var result securityEnrollmentResponse
				require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
				assert.Equal(t, http.StatusForbidden, response.Code)
				assert.Equal(t, "SECURITY_PROOF_REQUIRED", result.Code)
			})
		}
	})
}

// An administrator (not root) exercises the routine paths without touching the
// Casbin policy store, which the security fixture does not provision.
func TestAdminUserRoutineEditsDoNotRequireProof(t *testing.T) {
	_, identity, target := setupAdminUserTest(t)
	response := adminUserRequest(http.MethodPut, "/api/user/", fmt.Sprintf(`{"id":%d,"username":"managed-user","display_name":"Renamed","group":"default"}`, target.Id), "", identity, common.RoleAdminUser, nil, UpdateUser)
	var result securityEnrollmentResponse
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Success, response.Body.String())
	stored, err := model.GetUserById(target.Id, true)
	require.NoError(t, err)
	assert.Equal(t, "Renamed", stored.DisplayName)
	assert.True(t, common.ValidatePasswordAndHash("managed-password", stored.Password))

	response = adminUserRequest(http.MethodPost, "/api/user/", `{"username":"new-member","password":"member-password-1","role":1}`, "", identity, common.RoleAdminUser, nil, CreateUser)
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Success, response.Body.String())
	var count int64
	require.NoError(t, model.DB.Model(&model.User{}).Where("username = ?", "new-member").Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestCreateUserRejectsNonStandardRole(t *testing.T) {
	_, identity, _ := setupAdminUserTest(t)
	for i, test := range []struct {
		name         string
		role         int
		operatorRole int
	}{
		{"between common and admin", 5, common.RoleAdminUser},
		{"negative", -1, common.RoleAdminUser},
		{"between admin and root", 99, common.RoleRootUser},
	} {
		t.Run(test.name, func(t *testing.T) {
			username := fmt.Sprintf("odd-role-%d", i)
			body := fmt.Sprintf(`{"username":%q,"password":"member-password-1","role":%d}`, username, test.role)
			response := adminUserRequest(http.MethodPost, "/api/user/", body, "", identity, test.operatorRole, nil, CreateUser)
			var result securityEnrollmentResponse
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.Equal(t, http.StatusOK, response.Code)
			assert.False(t, result.Success)
			assert.Empty(t, result.Code)
			var count int64
			require.NoError(t, model.DB.Model(&model.User{}).Where("username = ?", username).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

func TestAdminUserProofIsBoundToTargetAndActionAndConsumedOnce(t *testing.T) {
	_, identity, target := setupNonRootAdminTest(t)
	other := &model.User{Username: "other-user", Password: target.Password, Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "other-aff"}
	require.NoError(t, model.DB.Create(other).Error)
	disableTarget := service.VerificationOperation{Scope: service.VerificationScopeAdminUserManage, Context: []byte(fmt.Sprintf(`{"user_id":%d,"action":"disable"}`, target.Id))}
	proof := issueSecurityEnrollmentProof(t, identity, disableTarget, service.VerificationMethodPassword)

	for _, test := range []struct {
		name, body, code string
		params           gin.Params
		handler          gin.HandlerFunc
	}{
		{"different action", fmt.Sprintf(`{"id":%d,"action":"enable"}`, target.Id), "SECURITY_PROOF_CONTEXT_MISMATCH", nil, ManageUser},
		{"different user", fmt.Sprintf(`{"id":%d,"action":"disable"}`, other.Id), "SECURITY_PROOF_CONTEXT_MISMATCH", nil, ManageUser},
		{"different scope", "", "SECURITY_PROOF_SCOPE_MISMATCH", gin.Params{{Key: "id", Value: fmt.Sprint(target.Id)}}, DeleteUser},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := adminUserRequest(http.MethodPost, "/api/user/manage", test.body, proof, identity, common.RoleAdminUser, test.params, test.handler)
			var result securityEnrollmentResponse
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.Equal(t, http.StatusForbidden, response.Code)
			assert.Equal(t, test.code, result.Code)
		})
	}
	for _, id := range []int{target.Id, other.Id} {
		stored, err := model.GetUserById(id, false)
		require.NoError(t, err)
		assert.Equal(t, common.UserStatusEnabled, stored.Status)
	}

	response := adminUserRequest(http.MethodPost, "/api/user/manage", fmt.Sprintf(`{"id":%d,"action":"disable"}`, target.Id), proof, identity, common.RoleAdminUser, nil, ManageUser)
	var result securityEnrollmentResponse
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Success, response.Body.String())
	stored, err := model.GetUserById(target.Id, false)
	require.NoError(t, err)
	assert.Equal(t, common.UserStatusDisabled, stored.Status)
	var audit model.AuditLog
	require.NoError(t, model.LOG_DB.Where("action = ?", "user.manage").Last(&audit).Error)
	require.NotNil(t, audit.Other.Op)
	verificationMethod, err := common.Marshal(audit.Other.Op.Params["verification_method"])
	require.NoError(t, err)
	assert.JSONEq(t, `"password"`, string(verificationMethod))
	targetUserID, err := common.Marshal(audit.Other.Op.Params["target_user_id"])
	require.NoError(t, err)
	assert.JSONEq(t, fmt.Sprint(target.Id), string(targetUserID))
	auditJSON, err := common.Marshal(audit)
	require.NoError(t, err)
	assert.NotContains(t, string(auditJSON), proof)

	response = adminUserRequest(http.MethodPost, "/api/user/manage", fmt.Sprintf(`{"id":%d,"action":"disable"}`, target.Id), proof, identity, common.RoleAdminUser, nil, ManageUser)
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	assert.Equal(t, http.StatusForbidden, response.Code)
	assert.Equal(t, "SECURITY_PROOF_CONSUMED", result.Code)
}

// The conditional bulk ban binds its proof to the exact condition the operator
// approved, so a proof cannot be replayed with a broader cut-off or another mode.
// Root is exempt from this proof, so the binding is exercised by an ordinary admin.
func TestAdminUserBatchBanProofIsBoundToTheCondition(t *testing.T) {
	_, identity, target := setupNonRootAdminTest(t)
	condition := func(mode string, before int64) string {
		return fmt.Sprintf(`{"mode":%q,"before":%d}`, mode, before)
	}
	proof := issueSecurityEnrollmentProof(t, identity, service.VerificationOperation{
		Scope:   service.VerificationScopeAdminUserManageBatch,
		Context: []byte(condition("last_call", 1)),
	}, service.VerificationMethodPassword)

	for _, mismatch := range []string{condition("last_call", 2), condition("last_login", 1)} {
		response := adminUserRequest(http.MethodPost, "/api/user/ban_by_condition", mismatch, proof, identity, common.RoleAdminUser, nil, BanUserByCondition)
		var result securityEnrollmentResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		assert.Equal(t, http.StatusForbidden, response.Code)
		assert.Equal(t, "SECURITY_PROOF_CONTEXT_MISMATCH", result.Code)
	}
	stored, err := model.GetUserById(target.Id, false)
	require.NoError(t, err)
	assert.Equal(t, common.UserStatusEnabled, stored.Status)

	response := adminUserRequest(http.MethodPost, "/api/user/ban_by_condition", condition("last_call", 1), proof, identity, common.RoleAdminUser, nil, BanUserByCondition)
	var result securityEnrollmentResponse
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Success, response.Body.String())
	stored, err = model.GetUserById(target.Id, false)
	require.NoError(t, err)
	assert.Equal(t, common.UserStatusDisabled, stored.Status)

	response = adminUserRequest(http.MethodPost, "/api/user/ban_by_condition", condition("last_call", 1), proof, identity, common.RoleAdminUser, nil, BanUserByCondition)
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	assert.Equal(t, http.StatusForbidden, response.Code)
	assert.Equal(t, "SECURITY_PROOF_CONSUMED", result.Code)
}

// A bulk ban by ids binds its proof to the exact id set, compared as a sorted,
// de-duplicated set. Root skips the proof entirely.
func TestAdminUserBanByIdsProofIsBoundToTheIdSet(t *testing.T) {
	_, identity, target := setupNonRootAdminTest(t)
	other := &model.User{Username: "other-user", Password: target.Password, Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "other-aff"}
	require.NoError(t, model.DB.Create(other).Error)
	idsBody := func(ids ...int) string {
		raw, err := common.Marshal(map[string]any{"ids": ids, "ban_reason": "batch_activity_check"})
		require.NoError(t, err)
		return string(raw)
	}
	// The proof is issued for the same set in a different order; binding sorts it.
	proof := issueSecurityEnrollmentProof(t, identity, service.VerificationOperation{
		Scope:   service.VerificationScopeAdminUserBanByIds,
		Context: []byte(fmt.Sprintf(`{"ids":[%d,%d]}`, other.Id, target.Id)),
	}, service.VerificationMethodPassword)

	response := adminUserRequest(http.MethodPost, "/api/user/ban_by_ids", idsBody(target.Id), proof, identity, common.RoleAdminUser, nil, BanUsersByIds)
	var result securityEnrollmentResponse
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	assert.Equal(t, http.StatusForbidden, response.Code)
	assert.Equal(t, "SECURITY_PROOF_CONTEXT_MISMATCH", result.Code)

	response = adminUserRequest(http.MethodPost, "/api/user/ban_by_ids", idsBody(target.Id, other.Id, target.Id), proof, identity, common.RoleAdminUser, nil, BanUsersByIds)
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Success, response.Body.String())
	var payload struct {
		Data struct {
			Banned int `json:"banned"`
			Failed []struct {
				Id     int    `json:"id"`
				Reason string `json:"reason"`
			} `json:"failed"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	assert.Equal(t, 2, payload.Data.Banned)
	assert.Empty(t, payload.Data.Failed)
	for _, id := range []int{target.Id, other.Id} {
		stored, err := model.GetUserById(id, false)
		require.NoError(t, err)
		assert.Equal(t, common.UserStatusDisabled, stored.Status)
	}

	response = adminUserRequest(http.MethodPost, "/api/user/ban_by_ids", idsBody(target.Id, other.Id), proof, identity, common.RoleAdminUser, nil, BanUsersByIds)
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	assert.Equal(t, http.StatusForbidden, response.Code)
	assert.Equal(t, "SECURITY_PROOF_CONSUMED", result.Code)
}

func TestAdminUserBindingProofDistinguishesBuiltInAndCustomBindings(t *testing.T) {
	_, identity, target := setupAdminUserTest(t)
	require.NoError(t, model.DB.Create(&model.UserOAuthBinding{UserId: target.Id, ProviderId: 7, ProviderUserId: "provider-user"}).Error)
	custom := service.VerificationOperation{Scope: service.VerificationScopeAdminUserBindingClear, Context: []byte(fmt.Sprintf(`{"user_id":%d,"provider_id":7}`, target.Id))}
	proof := issueSecurityEnrollmentProof(t, identity, custom, service.VerificationMethodPassword)
	params := gin.Params{{Key: "id", Value: fmt.Sprint(target.Id)}, {Key: "binding_type", Value: "github"}}
	response := adminUserRequest(http.MethodDelete, "/api/user/:id/bindings/:binding_type", "", proof, identity, common.RoleRootUser, params, AdminClearUserBinding)
	var result securityEnrollmentResponse
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	assert.Equal(t, "SECURITY_PROOF_CONTEXT_MISMATCH", result.Code)
	stored, err := model.GetUserById(target.Id, false)
	require.NoError(t, err)
	assert.Equal(t, "managed-github", stored.GitHubId)

	params = gin.Params{{Key: "id", Value: fmt.Sprint(target.Id)}, {Key: "provider_id", Value: "7"}}
	response = adminUserRequest(http.MethodDelete, "/api/user/:id/oauth/bindings/:provider_id", "", proof, identity, common.RoleRootUser, params, UnbindCustomOAuthByAdmin)
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Success, response.Body.String())
	bindings, err := model.GetUserOAuthBindingsByUserId(target.Id)
	require.NoError(t, err)
	assert.Empty(t, bindings)
	var audit model.AuditLog
	require.NoError(t, model.LOG_DB.Where("action = ?", "user.binding_clear").Last(&audit).Error)
	require.NotNil(t, audit.Other.Op)
	providerID, err := common.Marshal(audit.Other.Op.Params["provider_id"])
	require.NoError(t, err)
	assert.JSONEq(t, "7", string(providerID))
}

func TestAdminUserVerificationPolicy(t *testing.T) {
	t.Run("requires an administrator", func(t *testing.T) {
		_, identity := setupSecurityEnrollmentTest(t)
		_, err := service.GetVerificationRequirements(identity, service.VerificationScopeAdminUserDelete)
		assert.ErrorIs(t, err, service.ErrVerificationForbidden)
	})
	t.Run("falls back to the password without a second factor", func(t *testing.T) {
		_, identity, _ := setupAdminUserTest(t)
		requirements, err := service.GetVerificationRequirements(identity, service.VerificationScopeAdminUserDelete)
		require.NoError(t, err)
		assert.Equal(t, []service.VerificationMethodOption{{Method: service.VerificationMethodPassword, Available: true}}, requirements.Methods)
	})
	t.Run("prefers an enrolled second factor", func(t *testing.T) {
		operator, identity, _ := setupAdminUserTest(t)
		require.NoError(t, model.DB.Create(&model.TwoFA{UserId: operator.Id, Secret: "JBSWY3DPEHPK3PXP", IsEnabled: true}).Error)
		requirements, err := service.GetVerificationRequirements(identity, service.VerificationScopeAdminUserManage)
		require.NoError(t, err)
		assert.Equal(t, []service.VerificationMethodOption{{Method: service.VerificationMethodTwoFA, Available: true}}, requirements.Methods)
	})
	t.Run("a legacy token cannot present a proof", func(t *testing.T) {
		operator, identity, target := setupNonRootAdminTest(t)
		require.NoError(t, model.DB.Model(operator).Update("access_token", "legacy-admin-token").Error)
		proof := issueSecurityEnrollmentProof(t, identity, service.VerificationOperation{Scope: service.VerificationScopeAdminUserDelete, Context: []byte(fmt.Sprintf(`{"user_id":%d}`, target.Id))}, service.VerificationMethodPassword)
		response := accessTokenRequest(newAccessTokenTestRouter(), http.MethodDelete, fmt.Sprintf("/api/user/%d", target.Id), "legacy-admin-token", proof, "")
		assert.Equal(t, http.StatusForbidden, response.Code)
		assert.Equal(t, "SECURITY_PROOF_INVALID", decodeSecurityEnrollmentResponse(t, response).Code)
		_, err := model.GetUserById(target.Id, false)
		assert.NoError(t, err)
	})
	t.Run("a user:write token completes the deletion on its own proof", func(t *testing.T) {
		operator, _, target := setupNonRootAdminTest(t)
		require.NoError(t, model.DB.AutoMigrate(&model.ExternalIdentityClaim{}, &model.Token{}))
		raw, _ := createScopedAccessToken(t, operator.Id, 0, "user:write")
		router := newAccessTokenTestRouter()
		response := accessTokenRequest(router, http.MethodPost, "/api/verify", raw, "", fmt.Sprintf(`{"scope":"admin.user.delete","method":"password","password":"enrollment-password","context":{"user_id":%d}}`, target.Id))
		body := decodeSecurityEnrollmentResponse(t, response)
		require.True(t, body.Success, body.Message)
		var proof service.SecurityProof
		require.NoError(t, common.Unmarshal(body.Data, &proof))

		response = accessTokenRequest(router, http.MethodDelete, fmt.Sprintf("/api/user/%d", target.Id), raw, proof.ProofToken, "")
		body = decodeSecurityEnrollmentResponse(t, response)
		require.True(t, body.Success, body.Message)
		_, err := model.GetUserById(target.Id, true)
		assert.Error(t, err)
		var audit model.AuditLog
		require.NoError(t, model.LOG_DB.Where("action = ?", "user.delete").Last(&audit).Error)
		assert.Equal(t, "access_token", audit.AuthMethod)
		require.NotNil(t, audit.Other.Op)
		verificationMethod, err := common.Marshal(audit.Other.Op.Params["verification_method"])
		require.NoError(t, err)
		assert.JSONEq(t, `"password"`, string(verificationMethod))
		auditJSON, err := common.Marshal(audit)
		require.NoError(t, err)
		for _, secret := range []string{raw, proof.ProofToken, "enrollment-password"} {
			assert.NotContains(t, string(auditJSON), secret)
		}
	})
	// Accepted risk of the root exemption (D2=a): root credentials that cannot
	// perform step-up, such as the legacy token, now delete without proof.
	t.Run("a root legacy token deletes without proof", func(t *testing.T) {
		operator, _, target := setupAdminUserTest(t)
		require.NoError(t, model.DB.AutoMigrate(&model.ExternalIdentityClaim{}, &model.Token{}))
		require.NoError(t, model.DB.Model(operator).Update("access_token", "legacy-root-token").Error)
		response := accessTokenRequest(newAccessTokenTestRouter(), http.MethodDelete, fmt.Sprintf("/api/user/%d", target.Id), "legacy-root-token", "", "")
		body := decodeSecurityEnrollmentResponse(t, response)
		require.True(t, body.Success, body.Message)
		_, err := model.GetUserById(target.Id, true)
		assert.Error(t, err)
		var audit model.AuditLog
		require.NoError(t, model.LOG_DB.Where("action = ?", "user.delete").Last(&audit).Error)
		require.NotNil(t, audit.Other.Op)
		verificationMethod, err := common.Marshal(audit.Other.Op.Params["verification_method"])
		require.NoError(t, err)
		assert.JSONEq(t, `"root_exempt"`, string(verificationMethod))
	})
	t.Run("a user:read token cannot obtain a proof", func(t *testing.T) {
		operator, _, target := setupAdminUserTest(t)
		raw, _ := createScopedAccessToken(t, operator.Id, 0, "user:read")
		response := accessTokenRequest(newAccessTokenTestRouter(), http.MethodPost, "/api/verify", raw, "", fmt.Sprintf(`{"scope":"admin.user.delete","method":"password","password":"enrollment-password","context":{"user_id":%d}}`, target.Id))
		assert.Equal(t, http.StatusForbidden, response.Code)
		assert.Equal(t, "SECURITY_ACTION_FORBIDDEN", decodeSecurityEnrollmentResponse(t, response).Code)
		var flows int64
		require.NoError(t, model.DB.Model(&model.AuthFlow{}).Count(&flows).Error)
		assert.Zero(t, flows)
	})
}
