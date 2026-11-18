package model

import (
	"crypto/rand"
	"errors"
	"fmt"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/pkg/coincapture"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	CoinCapturePlaying = 1
	CoinCaptureSettled = 2
)

var (
	ErrCoinCaptureNotFound    = common.NewMessage("Game round was not found")
	ErrCoinCaptureConflict    = common.NewMessage("Game state changed; please retry")
	ErrCoinCaptureInput       = common.NewMessage("Invalid game movement")
	ErrCoinCaptureNotFinished = common.NewMessage("The game has not finished yet")
)

// CoinCaptureRound reserves one daily attempt and stores its authoritative
// state, immutable score and the quota reward credited to the player's wallet.
type CoinCaptureRound struct {
	Id          int    `json:"-" gorm:"primaryKey;autoIncrement"`                                                                          // Database-generated primary key.
	RoundId     string `json:"round_id" gorm:"type:varchar(32);not null;uniqueIndex"`                                                      // Random public round identifier; never authenticates a request by itself.
	UserId      int    `json:"-" gorm:"not null;uniqueIndex:ux_coin_capture_user_day"`                                                     // Authenticated player, unique together with GameDay.
	GameDay     string `json:"game_day" gorm:"type:varchar(10);not null;uniqueIndex:ux_coin_capture_user_day"`                             // Date of the attempt in Asia/Shanghai, YYYY-MM-DD; reserved at start.
	DisplayName string `json:"display_name" gorm:"type:varchar(128);not null"`                                                             // Public display name snapshot; fallback usernames are masked.
	Status      int    `json:"status" gorm:"not null;index:idx_coin_capture_pending,priority:1;index:idx_coin_capture_ranking,priority:1"` // 1 while playing, 2 after an atomic and idempotent settlement.
	State       string `json:"-" gorm:"type:text;not null"`                                                                                // Server-generated initial state, including replay randomness; cleared after settlement and never accepted from clients.
	Score       int    `json:"score" gorm:"not null;index:idx_coin_capture_ranking,priority:2"`                                            // Server-calculated final score in [0, 9999].
	RewardCents int    `json:"reward_cents" gorm:"not null"`                                                                               // floor(Score/10), so 5130 and 5136 both convert to 513 cents of base quota value.
	Quota       int    `json:"quota" gorm:"type:bigint;not null"`                                                                          // Actual internal quota credited, converted with the top-up quota helper.
	TopUpId     int    `json:"top_up_id" gorm:"not null"`                                                                                  // Legacy payment-order reference; new rewards use top-up type usage logs and leave this zero.
	StartedAt   int64  `json:"started_at" gorm:"bigint;not null;index:idx_coin_capture_pending,priority:2"`                                // Server Unix milliseconds when the 40-second timer starts.
	SettledAt   int64  `json:"settled_at" gorm:"bigint;not null"`                                                                          // Server Unix milliseconds when score and quota are committed; zero until settled.
	Sequence    int64  `json:"sequence" gorm:"bigint;not null"`                                                                            // Number of replayed target changes after settlement; legacy rounds used a movement sequence.
	Revision    int64  `json:"-" gorm:"bigint;not null"`                                                                                   // Compare-and-swap revision that also protects SQLite, which has no SELECT FOR UPDATE.
	LastInputAt int64  `json:"-" gorm:"bigint;not null"`                                                                                   // Legacy last-sync timestamp; retained for existing rows, new rounds set it to StartedAt.
}

func (CoinCaptureRound) TableName() string { return "coin_capture_rounds" }

type CoinCaptureView struct {
	Round        *CoinCaptureRound `json:"round"`
	Game         *coincapture.Game `json:"game,omitempty"`
	ServerTime   int64             `json:"server_time"`
	RewardAmount string            `json:"reward_amount"`
}

func GetCoinCaptureToday(userId int, now time.Time) (*CoinCaptureView, error) {
	var round CoinCaptureRound
	err := DB.Where("user_id = ? AND game_day = ?", userId, now.In(shanghaiLocation).Format("2006-01-02")).First(&round).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &CoinCaptureView{ServerTime: now.UnixMilli(), RewardAmount: "0.00"}, nil
	}
	if err != nil {
		return nil, err
	}
	view := &CoinCaptureView{Round: &round, ServerTime: now.UnixMilli(), RewardAmount: fmt.Sprintf("%d.%02d", round.RewardCents/100, round.RewardCents%100)}
	if round.Status == CoinCapturePlaying {
		view.Game = &coincapture.Game{}
		if err := common.UnmarshalJsonStr(round.State, view.Game); err != nil {
			return nil, err
		}
	}
	return view, nil
}

func StartCoinCaptureRound(userId int, now time.Time) (*CoinCaptureView, error) {
	var user User
	if err := DB.Select("id", "username", "display_name", "status").First(&user, "id = ?", userId).Error; err != nil {
		return nil, err
	}
	if user.Status != common.UserStatusEnabled {
		return nil, gorm.ErrRecordNotFound
	}
	name := user.DisplayName
	if name == "" {
		name = user.Username
		_, size := utf8.DecodeRuneInString(name)
		if size > 0 {
			name = name[:size] + "***"
		}
	}
	state, err := common.Marshal(coincapture.NewGame())
	if err != nil {
		return nil, err
	}
	round := CoinCaptureRound{
		RoundId: rand.Text(), UserId: userId, GameDay: now.In(shanghaiLocation).Format("2006-01-02"),
		DisplayName: name, Status: CoinCapturePlaying, State: string(state),
		StartedAt: now.UnixMilli(), LastInputAt: now.UnixMilli(),
	}
	// The unique user/day reservation is shared across processes and survives
	// refreshes, restarts, duplicate POSTs and midnight boundaries.
	if err := DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}, {Name: "game_day"}}, DoNothing: true,
	}).Create(&round).Error; err != nil {
		return nil, err
	}
	return GetCoinCaptureToday(userId, now)
}

// SettleCoinCaptureRound replays local movement once using the server's stored
// state, then atomically commits the final result and credits the wallet.
func SettleCoinCaptureRound(userId int, roundId string, movements []coincapture.Movement, now time.Time) (*CoinCaptureView, error) {
	if roundId == "" || len(roundId) > 32 || userId <= 0 {
		return nil, ErrCoinCaptureNotFound
	}
	if len(movements) > coincapture.DurationMS/coincapture.StepMS {
		return nil, ErrCoinCaptureInput
	}
	var view CoinCaptureView
	var credited int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var round CoinCaptureRound
		if err := lockForUpdate(tx).Where("round_id = ? AND user_id = ?", roundId, userId).First(&round).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrCoinCaptureNotFound
			}
			return err
		}
		view.Round, view.ServerTime = &round, now.UnixMilli()
		view.RewardAmount = fmt.Sprintf("%d.%02d", round.RewardCents/100, round.RewardCents%100)
		if round.Status == CoinCaptureSettled {
			return nil
		}
		if now.UnixMilli()-round.StartedAt < coincapture.DurationMS {
			return ErrCoinCaptureNotFinished
		}
		game := &coincapture.Game{}
		if err := common.UnmarshalJsonStr(round.State, game); err != nil {
			return err
		}
		if err := game.Replay(movements); err != nil {
			return ErrCoinCaptureInput
		}
		if game.Score < 0 || game.Score > coincapture.MaxScore {
			return ErrCoinCaptureInput
		}
		round.Score = game.Score
		round.RewardCents = game.Score / 10
		view.RewardAmount = fmt.Sprintf("%d.%02d", round.RewardCents/100, round.RewardCents%100)
		round.Status = CoinCaptureSettled
		round.SettledAt = now.UnixMilli()
		round.State = ""
		round.Sequence = int64(len(movements))
		if round.RewardCents > 0 {
			value := decimal.NewFromInt(int64(round.RewardCents)).Div(decimal.NewFromInt(100))
			quota, err := common.WalletQuotaFromDecimalStrict(value.Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
			if err != nil || quota <= 0 {
				return ErrInvalidTopUpQuota
			}
			round.Quota = quota
		}
		update := tx.Model(&CoinCaptureRound{}).Where("id = ? AND revision = ? AND status = ?", round.Id, round.Revision, CoinCapturePlaying).
			Updates(map[string]any{
				"state": round.State, "score": round.Score, "reward_cents": round.RewardCents,
				"quota": round.Quota, "status": round.Status, "settled_at": round.SettledAt,
				"sequence": round.Sequence, "last_input_at": round.LastInputAt, "revision": round.Revision + 1,
			})
		if update.Error != nil {
			return update.Error
		}
		if update.RowsAffected != 1 {
			return ErrCoinCaptureConflict
		}
		if round.Status != CoinCaptureSettled || round.Quota == 0 {
			return nil
		}
		// Grant the reward atomically with settlement and enforce the wallet
		// ceiling. Like lottery awards, this does not create a payment order.
		if err := creditTopUpQuota(tx.Where("status = ?", common.UserStatusEnabled), userId, round.Quota, nil); err != nil {
			return err
		}
		credited = round.Quota
		return nil
	})
	if err != nil {
		return nil, err
	}
	if credited > 0 {
		syncCreditUserQuotaCache(userId, credited, "coin capture")
		RecordLog(userId, LogTypeTopup, common.NewMessage("Coin Capture Operation: score {{score}}, quota added {{quota}}", map[string]any{
			"score": view.Round.Score, "quota": logger.FormatQuota(credited),
		}))
	}
	return &view, nil
}

// GetCoinCaptureLeaderboard returns each player's best settled result, with
// stable ties and a server-enforced maximum of 50 distinct players.
type CoinCaptureRanking struct {
	RoundId     string `json:"round_id"`
	DisplayName string `json:"display_name"`
	Score       int    `json:"score"`
}

func GetCoinCaptureLeaderboard() ([]CoinCaptureRanking, error) {
	var rounds []CoinCaptureRound
	query := DB.Model(&CoinCaptureRound{}).
		Select("round_id", "display_name", "score").
		Where("status = ?", CoinCaptureSettled).
		Where(`NOT EXISTS (SELECT 1 FROM coin_capture_rounds AS better WHERE better.user_id = coin_capture_rounds.user_id AND better.status = ? AND (better.score > coin_capture_rounds.score OR (better.score = coin_capture_rounds.score AND better.id < coin_capture_rounds.id)))`, CoinCaptureSettled).
		Order("score DESC, settled_at ASC, id ASC").Limit(50)
	if err := query.Find(&rounds).Error; err != nil {
		return nil, err
	}
	rankings := make([]CoinCaptureRanking, 0, len(rounds))
	for _, round := range rounds {
		rankings = append(rankings, CoinCaptureRanking{
			RoundId: round.RoundId, DisplayName: round.DisplayName, Score: round.Score,
		})
	}
	return rankings, nil
}
