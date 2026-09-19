package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestImageStudioDailyUsageLimitAndRollback(t *testing.T) {
	originalDB := DB
	originalDatabaseType := common.MainDatabaseType()
	db, err := gorm.Open(sqlite.Open("file:image-studio-usage?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &ImageStudioDailyUsage{}))
	DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		DB = originalDB
		common.SetMainDatabaseType(originalDatabaseType)
	})

	require.NoError(t, DB.Create(&User{Id: 7, Username: "image-user"}).Error)

	used, err := ReserveTodayImageStudioUsage(7, 2)
	require.NoError(t, err)
	assert.Equal(t, 1, used)

	used, err = ReserveTodayImageStudioUsage(7, 2)
	require.NoError(t, err)
	assert.Equal(t, 2, used)

	_, err = ReserveTodayImageStudioUsage(7, 2)
	assert.ErrorIs(t, err, ErrImageStudioDailyLimitReached)

	require.NoError(t, ReleaseTodayImageStudioUsage(7))
	used, err = GetTodayImageStudioUsage(7)
	require.NoError(t, err)
	assert.Equal(t, 1, used)
}
