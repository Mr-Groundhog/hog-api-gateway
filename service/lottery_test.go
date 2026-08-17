package service

import (
	"errors"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupLotteryTestDB(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.LotteryPrize{}, &model.LotteryDrawRecord{}))
	model.DB = db
	t.Cleanup(func() {
		model.DB = previousDB
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})
}

func TestPickLotteryPrizeUsesExactWeightBoundaries(t *testing.T) {
	prizes := []model.LotteryPrize{
		{Code: "first", Weight: 1},
		{Code: "second", Weight: 5},
		{Code: "third", Weight: 2},
	}
	tests := []struct {
		randomValue int64
		wantCode    string
	}{
		{randomValue: 0, wantCode: "first"},
		{randomValue: 1, wantCode: "second"},
		{randomValue: 5, wantCode: "second"},
		{randomValue: 6, wantCode: "third"},
		{randomValue: 7, wantCode: "third"},
	}

	for _, test := range tests {
		prize, err := pickLotteryPrize(prizes, test.randomValue)
		require.NoError(t, err)
		assert.Equal(t, test.wantCode, prize.Code)
	}
}

func TestPickLotteryPrizeRejectsInvalidConfiguration(t *testing.T) {
	_, err := pickLotteryPrize(nil, 0)
	assert.ErrorIs(t, err, ErrLotteryNotConfigured)

	_, err = pickLotteryPrize([]model.LotteryPrize{{Code: "disabled", Weight: 0}}, 0)
	assert.ErrorIs(t, err, ErrLotteryNotConfigured)
}

func TestDrawLotteryEnforcesOneDrawPerShanghaiBusinessDay(t *testing.T) {
	setupLotteryTestDB(t)
	prize := model.LotteryPrize{
		Code: "first", Name: "一等奖", Label: "品牌礼盒", Icon: "1",
		Tone: "red", Weight: 1, SortOrder: 1, Active: true,
	}
	require.NoError(t, model.DB.Create(&prize).Error)

	firstDrawAt := time.Date(2026, 8, 17, 14, 0, 0, 0, time.UTC)
	result, err := DrawLottery(7, "林小满", firstDrawAt)
	require.NoError(t, err)
	assert.Equal(t, "first", result.PrizeCode)
	assert.Equal(t, 0, result.BoardIndex)

	_, err = DrawLottery(7, "林小满", firstDrawAt.Add(time.Minute))
	assert.ErrorIs(t, err, ErrLotteryDailyLimitReached)

	result, err = DrawLottery(7, "林小满", firstDrawAt.Add(25*time.Hour))
	require.NoError(t, err)
	assert.Equal(t, "first", result.PrizeCode)
}

func TestCreateLotteryDrawRecordMapsUniqueConflictToDailyLimit(t *testing.T) {
	setupLotteryTestDB(t)
	first := &model.LotteryDrawRecord{
		UserId: 9, DrawDay: "2026-08-17", DisplayName: "林小满",
		PrizeCode: "first", PrizeName: "一等奖", PrizeLabel: "品牌礼盒",
		CreatedAt: time.Date(2026, 8, 17, 2, 0, 0, 0, time.UTC),
	}
	require.NoError(t, model.CreateLotteryDrawRecord(first))

	second := *first
	second.Id = 0
	second.PrizeCode = "second"
	err := model.CreateLotteryDrawRecord(&second)
	assert.True(t, errors.Is(err, model.ErrLotteryDailyLimitReached))

	var count int64
	require.NoError(t, model.DB.Model(&model.LotteryDrawRecord{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}
