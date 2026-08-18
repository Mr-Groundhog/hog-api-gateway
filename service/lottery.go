package service

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math"
	"math/big"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
)

var (
	ErrLotteryDailyLimitReached = model.ErrLotteryDailyLimitReached
	ErrLotteryNotConfigured     = errors.New("lottery is not configured")
	ErrLotteryQuotaOverflow     = model.ErrLotteryQuotaOverflow
)

type LotteryDrawResult struct {
	PrizeCode   string `json:"prizeCode"`
	PrizeName   string `json:"prizeName"`
	PrizeLabel  string `json:"prizeLabel"`
	PrizeIcon   string `json:"prizeIcon"`
	PrizeTone   string `json:"prizeTone"`
	BoardIndex  int    `json:"boardIndex"`
	QuotaAmount int    `json:"quotaAmount"`
}

type LotteryPublicRecord struct {
	Id          int64     `json:"id"`
	DisplayName string    `json:"displayName"`
	PrizeCode   string    `json:"prizeCode"`
	PrizeName   string    `json:"prizeName"`
	PrizeLabel  string    `json:"prizeLabel"`
	QuotaAmount int       `json:"quotaAmount"`
	CreatedAt   time.Time `json:"createdAt"`
}

// LotteryPublicPrize is the public view of a prize shown on the lottery board.
// It intentionally omits internal fields such as weight, but exposes the
// credited quota amount so the board can show the cash value.
type LotteryPublicPrize struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	Label       string `json:"label"`
	Icon        string `json:"icon"`
	Tone        string `json:"tone"`
	QuotaAmount int    `json:"quotaAmount"`
	SortOrder   int    `json:"sortOrder"`
}

func pickLotteryPrize(prizes []model.LotteryPrize, randomValue int64) (model.LotteryPrize, error) {
	if len(prizes) == 0 {
		return model.LotteryPrize{}, ErrLotteryNotConfigured
	}

	var total int64
	for _, prize := range prizes {
		if prize.Weight <= 0 || total > math.MaxInt64-int64(prize.Weight) {
			return model.LotteryPrize{}, ErrLotteryNotConfigured
		}
		total += int64(prize.Weight)
	}
	if randomValue < 0 || randomValue >= total {
		return model.LotteryPrize{}, fmt.Errorf("lottery random value out of range")
	}

	for _, prize := range prizes {
		randomValue -= int64(prize.Weight)
		if randomValue < 0 {
			return prize, nil
		}
	}
	return model.LotteryPrize{}, ErrLotteryNotConfigured
}

func DrawLottery(userId int, username string, now time.Time) (*LotteryDrawResult, error) {
	drawDay := model.LotteryBusinessDay(now)
	drawn, err := model.HasLotteryDrawn(userId, drawDay)
	if err != nil {
		return nil, err
	}
	if drawn {
		return nil, ErrLotteryDailyLimitReached
	}

	prizes, err := model.GetActiveLotteryPrizes()
	if err != nil {
		return nil, err
	}
	if len(prizes) == 0 {
		return nil, ErrLotteryNotConfigured
	}
	var total int64
	for _, prize := range prizes {
		if prize.Weight <= 0 || total > math.MaxInt64-int64(prize.Weight) {
			return nil, ErrLotteryNotConfigured
		}
		total += int64(prize.Weight)
	}
	if total <= 0 {
		return nil, ErrLotteryNotConfigured
	}

	randomNumber, err := rand.Int(rand.Reader, big.NewInt(total))
	if err != nil {
		return nil, err
	}
	selected, err := pickLotteryPrize(prizes, randomNumber.Int64())
	if err != nil {
		return nil, err
	}

	record := &model.LotteryDrawRecord{
		UserId:      userId,
		DrawDay:     drawDay,
		DisplayName: username,
		PrizeCode:   selected.Code,
		PrizeName:   selected.Name,
		PrizeLabel:  selected.Label,
		QuotaAmount: selected.QuotaAmount,
		CreatedAt:   now.UTC(),
	}
	if err := model.CreateLotteryDrawRecordTx(userId, drawDay, record, selected.QuotaAmount); err != nil {
		return nil, err
	}

	if selected.QuotaAmount > 0 {
		model.RecordLog(userId, model.LogTypeTopup, fmt.Sprintf(
			"通过九宫格抽奖获得额度: %v", logger.LogQuota(selected.QuotaAmount)))
	}

	return &LotteryDrawResult{
		PrizeCode:   selected.Code,
		PrizeName:   selected.Name,
		PrizeLabel:  selected.Label,
		PrizeIcon:   selected.Icon,
		PrizeTone:   selected.Tone,
		BoardIndex:  selected.SortOrder - 1,
		QuotaAmount: selected.QuotaAmount,
	}, nil
}

func GetTodayLotteryRecords(now time.Time) ([]LotteryPublicRecord, error) {
	records, err := model.GetLotteryDrawRecords(model.LotteryBusinessDay(now))
	if err != nil {
		return nil, err
	}

	publicRecords := make([]LotteryPublicRecord, 0, len(records))
	for _, record := range records {
		publicRecords = append(publicRecords, LotteryPublicRecord{
			Id:          record.Id,
			DisplayName: record.DisplayName,
			PrizeCode:   record.PrizeCode,
			PrizeName:   record.PrizeName,
			PrizeLabel:  record.PrizeLabel,
			QuotaAmount: record.QuotaAmount,
			CreatedAt:   record.CreatedAt,
		})
	}
	return publicRecords, nil
}

// GetPublicLotteryPrizes returns the active prizes for the lottery board,
// ordered by board position. Internal fields such as weight are not exposed.
func GetPublicLotteryPrizes() ([]LotteryPublicPrize, error) {
	prizes, err := model.GetActiveLotteryPrizes()
	if err != nil {
		return nil, err
	}
	public := make([]LotteryPublicPrize, 0, len(prizes))
	for _, prize := range prizes {
		public = append(public, LotteryPublicPrize{
			Code:        prize.Code,
			Name:        prize.Name,
			Label:       prize.Label,
			Icon:        prize.Icon,
			Tone:        prize.Tone,
			QuotaAmount: prize.QuotaAmount,
			SortOrder:   prize.SortOrder,
		})
	}
	return public, nil
}

func ListLotteryPrizes() ([]model.LotteryPrize, error) {
	return model.GetAllLotteryPrizes()
}

// SaveLotteryPrize creates a new prize when Id is 0, otherwise updates the
// existing one. It validates the business fields before persisting.
func SaveLotteryPrize(prize *model.LotteryPrize) error {
	if strings.TrimSpace(prize.Code) == "" {
		return errors.New("奖项编码不能为空")
	}
	if strings.TrimSpace(prize.Name) == "" {
		return errors.New("奖项名称不能为空")
	}
	if prize.Weight < 0 {
		return errors.New("权重不能为负数")
	}
	if prize.QuotaAmount < 0 {
		return errors.New("额度值不能为负数")
	}
	if prize.QuotaAmount > common.MaxQuota {
		// quota_amount is credited into the user's int32 quota column; reject a
		// configured value that could not be represented / would overflow it.
		return fmt.Errorf("额度值不能超过上限 %d（约 $%.2f）", common.MaxQuota, float64(common.MaxQuota)/common.QuotaPerUnit)
	}
	if prize.SortOrder <= 0 {
		return errors.New("排序必须大于 0")
	}

	if prize.Id == 0 {
		return model.CreateLotteryPrize(prize)
	}
	return model.UpdateLotteryPrize(prize)
}

// RemoveLotteryPrize deletes a prize configuration by its primary key.
func RemoveLotteryPrize(id int) error {
	return model.DeleteLotteryPrize(id)
}

// LotteryDailyLimit is the fixed number of draws allowed per user per business day.
const LotteryDailyLimit = 1

// GetLotteryRemaining returns how many draws the user still has for the current
// business day. The lottery currently allows one draw per day, so the result is
// either 1 (not drawn yet) or 0 (already drawn today).
func GetLotteryRemaining(userId int, now time.Time) (int, error) {
	drawn, err := model.HasLotteryDrawn(userId, model.LotteryBusinessDay(now))
	if err != nil {
		return 0, err
	}
	if drawn {
		return 0, nil
	}
	return LotteryDailyLimit, nil
}

// LotteryUserDraw is the user's own draw result for today, shown on their
// lottery page so they can see what they won (and how much quota they got).
type LotteryUserDraw struct {
	PrizeName   string    `json:"prizeName"`
	PrizeLabel  string    `json:"prizeLabel"`
	QuotaAmount int       `json:"quotaAmount"`
	CreatedAt   time.Time `json:"createdAt"`
}

// GetTodayLotteryResult returns the current user's draw result for today. It
// returns nil when the user has not drawn yet today.
func GetTodayLotteryResult(userId int, now time.Time) (*LotteryUserDraw, error) {
	record, err := model.GetTodayUserDraw(userId, model.LotteryBusinessDay(now))
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, nil
	}
	return &LotteryUserDraw{
		PrizeName:   record.PrizeName,
		PrizeLabel:  record.PrizeLabel,
		QuotaAmount: record.QuotaAmount,
		CreatedAt:   record.CreatedAt,
	}, nil
}

// GetTodayLotteryRank returns the current user's rank among today's winners by
// credited quota (descending). It returns nil when the user has not drawn yet
// today. Users with the same quota share the same rank (rank = count of winners
// with a strictly higher quota + 1).
func GetTodayLotteryRank(userId int, now time.Time) (*int, error) {
	drawDay := model.LotteryBusinessDay(now)
	record, err := model.GetTodayUserDraw(userId, drawDay)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, nil
	}

	var higher int64
	if err := model.DB.Model(&model.LotteryDrawRecord{}).
		Where("draw_day = ? AND quota_amount > ?", drawDay, record.QuotaAmount).
		Count(&higher).Error; err != nil {
		return nil, err
	}
	rank := int(higher) + 1
	return &rank, nil
}

// LotteryUserRecord is one of the current user's own draw records, used by the
// "history" tab on the lottery page.
type LotteryUserRecord struct {
	PrizeName   string    `json:"prizeName"`
	PrizeLabel  string    `json:"prizeLabel"`
	QuotaAmount int       `json:"quotaAmount"`
	CreatedAt   time.Time `json:"createdAt"`
}

// GetMyLotteryRecords returns the current user's own draw history ordered by
// time descending, capped at a reasonable size for the fixed-height tab panel.
func GetMyLotteryRecords(userId int) ([]LotteryUserRecord, error) {
	records, err := model.GetUserLotteryDrawRecords(userId, 200)
	if err != nil {
		return nil, err
	}
	result := make([]LotteryUserRecord, 0, len(records))
	for _, record := range records {
		result = append(result, LotteryUserRecord{
			PrizeName:   record.PrizeName,
			PrizeLabel:  record.PrizeLabel,
			QuotaAmount: record.QuotaAmount,
			CreatedAt:   record.CreatedAt,
		})
	}
	return result, nil
}
