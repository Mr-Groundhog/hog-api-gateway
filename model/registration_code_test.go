package model

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func insertTestRegistrationCode(t *testing.T, status int, expiredTime int64) *RegistrationCode {
	t.Helper()
	code := &RegistrationCode{
		UserId:      1,
		Name:        "test-code",
		Key:         "abcdefgh",
		Status:      status,
		CreatedTime: common.GetTimestamp() - 100,
		ExpiredTime: expiredTime,
	}
	require.NoError(t, code.Insert())
	return code
}

func TestGenerateRegistrationCodeKey(t *testing.T) {
	key, err := generateRegistrationCodeKey()
	require.NoError(t, err)
	require.Len(t, key, 8)
	for _, ch := range key {
		assert.Contains(t, registrationCodeAlphabet, string(ch))
	}
}

func TestGenerateUniqueRegistrationCodeKey(t *testing.T) {
	existing, err := GenerateUniqueRegistrationCodeKey()
	require.NoError(t, err)
	require.NoError(t, DB.Create(&RegistrationCode{
		UserId: 1, Name: "dup", Key: existing, Status: common.RedemptionCodeStatusEnabled,
	}).Error)

	// Existing key must be skipped; the returned key is new and unique.
	key, err := GenerateUniqueRegistrationCodeKey()
	require.NoError(t, err)
	require.NotEqual(t, existing, key)
	var count int64
	require.NoError(t, DB.Model(&RegistrationCode{}).Where("`key` = ?", key).Count(&count).Error)
	assert.Zero(t, count)
}

func TestConsumeRegistrationCode(t *testing.T) {
	t.Run("success binds user info", func(t *testing.T) {
		DB.Unscoped().Where("1 = 1").Delete(&RegistrationCode{})
		code := insertTestRegistrationCode(t, common.RedemptionCodeStatusEnabled, 0)

		id, err := ConsumeRegistrationCode(code.Key, 42, "alice")
		require.NoError(t, err)
		assert.Equal(t, code.Id, id)

		var updated RegistrationCode
		require.NoError(t, DB.First(&updated, "id = ?", code.Id).Error)
		assert.Equal(t, common.RedemptionCodeStatusUsed, updated.Status)
		assert.Equal(t, 42, updated.UsedUserId)
		assert.Equal(t, "alice", updated.UsedUsername)
		assert.Greater(t, updated.UsedTime, int64(0))
	})

	t.Run("unknown key is invalid", func(t *testing.T) {
		_, err := ConsumeRegistrationCode("zzzzzzzz", 1, "bob")
		assert.ErrorIs(t, err, ErrRegistrationCodeInvalid)
	})

	t.Run("already used code is rejected", func(t *testing.T) {
		DB.Unscoped().Where("1 = 1").Delete(&RegistrationCode{})
		code := insertTestRegistrationCode(t, common.RedemptionCodeStatusUsed, 0)
		_, err := ConsumeRegistrationCode(code.Key, 1, "bob")
		assert.ErrorIs(t, err, ErrRegistrationCodeUsed)
	})

	t.Run("disabled code is rejected", func(t *testing.T) {
		DB.Unscoped().Where("1 = 1").Delete(&RegistrationCode{})
		code := insertTestRegistrationCode(t, common.RedemptionCodeStatusDisabled, 0)
		_, err := ConsumeRegistrationCode(code.Key, 1, "bob")
		assert.ErrorIs(t, err, ErrRegistrationCodeUsed)
	})

	t.Run("expired code is rejected", func(t *testing.T) {
		DB.Unscoped().Where("1 = 1").Delete(&RegistrationCode{})
		code := insertTestRegistrationCode(t, common.RedemptionCodeStatusEnabled, common.GetTimestamp()-10)
		_, err := ConsumeRegistrationCode(code.Key, 1, "bob")
		assert.ErrorIs(t, err, ErrRegistrationCodeExpired)
	})

	t.Run("empty key and invalid user are rejected", func(t *testing.T) {
		_, err := ConsumeRegistrationCode("", 1, "bob")
		require.Error(t, err)
		_, err = ConsumeRegistrationCode("abcdefgh", 0, "bob")
		require.Error(t, err)
	})

	t.Run("restore reverts consumption", func(t *testing.T) {
		DB.Unscoped().Where("1 = 1").Delete(&RegistrationCode{})
		code := insertTestRegistrationCode(t, common.RedemptionCodeStatusEnabled, 0)
		id, err := ConsumeRegistrationCode(code.Key, 42, "alice")
		require.NoError(t, err)

		RestoreRegistrationCode(id)
		var restored RegistrationCode
		require.NoError(t, DB.First(&restored, "id = ?", code.Id).Error)
		assert.Equal(t, common.RedemptionCodeStatusEnabled, restored.Status)
		assert.Zero(t, restored.UsedUserId)
		assert.Equal(t, "", restored.UsedUsername)
		assert.Zero(t, restored.UsedTime)
	})
}

func TestSearchRegistrationCodesByKey(t *testing.T) {
	DB.Unscoped().Where("1 = 1").Delete(&RegistrationCode{})
	code := insertTestRegistrationCode(t, common.RedemptionCodeStatusEnabled, 0)

	codes, total, err := SearchRegistrationCodes(strings.ToUpper(code.Key), "", 0, 10)
	require.NoError(t, err)
	// Key search is exact-match: the uppercase form must not match.
	assert.Zero(t, total)
	assert.Empty(t, codes)

	codes, total, err = SearchRegistrationCodes(code.Key, "", 0, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, codes, 1)
	assert.Equal(t, code.Id, codes[0].Id)
}

func TestCheckRegistrationCodeValid(t *testing.T) {
	DB.Unscoped().Where("1 = 1").Delete(&RegistrationCode{})

	valid, reason := CheckRegistrationCodeValid("nope1234")
	assert.False(t, valid)
	assert.Equal(t, "invalid", reason)

	code := insertTestRegistrationCode(t, common.RedemptionCodeStatusEnabled, 0)
	valid, reason = CheckRegistrationCodeValid(code.Key)
	assert.True(t, valid)
	assert.Empty(t, reason)

	DB.Model(&RegistrationCode{}).Where("id = ?", code.Id).Update("status", common.RedemptionCodeStatusUsed)
	valid, reason = CheckRegistrationCodeValid(code.Key)
	assert.False(t, valid)
	assert.Equal(t, "used", reason)

	DB.Unscoped().Where("1 = 1").Delete(&RegistrationCode{})
	expired := insertTestRegistrationCode(t, common.RedemptionCodeStatusEnabled, common.GetTimestamp()-10)
	valid, reason = CheckRegistrationCodeValid(expired.Key)
	assert.False(t, valid)
	assert.Equal(t, "expired", reason)
}
