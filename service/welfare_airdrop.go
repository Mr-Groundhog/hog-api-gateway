package service

import (
	"errors"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// 福利空投的配置边界。Quota 与 TotalCount 都会参与额度发放，必须在写入前收敛，
// 避免管理员误填的巨大数值在领取时把额度列冲到饱和边界。
const (
	MaxWelfareAirdropNameLength        = 64
	MaxWelfareAirdropDescriptionLength = 255
	MaxWelfareAirdropTotalCount        = 1000000
	MaxWelfareAirdropPerUserLimit      = 1
	// WelfareAirdropClaimHistoryLimit 限制领取历史面板展示的最近记录条数。
	WelfareAirdropClaimHistoryLimit = 10
)

// 空投在用户视角下的展示状态，由后端统一判定，前端只负责渲染。
const (
	WelfareAirdropStateUpcoming = "upcoming"
	WelfareAirdropStateActive   = "active"
	WelfareAirdropStateSoldOut  = "sold_out"
	WelfareAirdropStateEnded    = "ended"
	WelfareAirdropStateClaimed  = "claimed"
)

var (
	ErrWelfareAirdropNameLength   = errors.New("活动名称长度需在 1 到 64 个字符之间")
	ErrWelfareAirdropDescLength   = errors.New("活动说明长度不能超过 255 个字符")
	ErrWelfareAirdropQuotaRange   = errors.New("单份额度必须为正数且不超过额度上限")
	ErrWelfareAirdropCountRange   = errors.New("总份数不能为负数，且不能超过 1000000")
	ErrWelfareAirdropLimitRange   = errors.New("同一批次每个用户只能领取 1 次")
	ErrWelfareAirdropTimeInvalid  = errors.New("结束时间必须晚于开始时间")
	ErrWelfareAirdropStatusInvald = errors.New("无效的活动状态")
)

// WelfareAirdropView 是一场空投对当前登录用户的展示视图。它只暴露前端渲染所需的
// 字段，并把「能否领取」的判定结果一并下发，避免前端重复实现时间窗口与限次规则。
type WelfareAirdropView struct {
	Id           int    `json:"id"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	Quota        int    `json:"quota"`
	TotalCount   int    `json:"totalCount"`
	ClaimedCount int    `json:"claimedCount"`
	Remaining    int    `json:"remaining"`
	Unlimited    bool   `json:"unlimited"`
	PerUserLimit int    `json:"perUserLimit"`
	ClaimedByMe  int    `json:"claimedByMe"`
	CanClaim     bool   `json:"canClaim"`
	State        string `json:"state"`
	StartTime    int64  `json:"startTime"`
	EndTime      int64  `json:"endTime"`
	BatchId      string `json:"batchId"`
}

// WelfareAirdropClaimView 是一条领取记录的展示视图，包含本次签发的兑换码明文，
// 便于用户在领取历史里查看与复制。
type WelfareAirdropClaimView struct {
	Id            int    `json:"id"`
	AirdropId     int    `json:"airdropId"`
	AirdropName   string `json:"airdropName"`
	Quota         int    `json:"quota"`
	RedemptionKey string `json:"redemptionKey"`
	CreatedTime   int64  `json:"createdTime"`
}

func toWelfareAirdropClaimView(claim *model.WelfareAirdropClaim) WelfareAirdropClaimView {
	return WelfareAirdropClaimView{
		Id:            claim.Id,
		AirdropId:     claim.AirdropId,
		AirdropName:   claim.AirdropName,
		Quota:         claim.Quota,
		RedemptionKey: claim.RedemptionKey,
		CreatedTime:   claim.CreatedTime,
	}
}

// ListWelfareAirdropsForUser 返回当前用户可见的空投列表：启用中且未过期的活动，
// 附带该用户已领取的次数与是否还能继续领取。活动对所有用户开放，不区分分组。
func ListWelfareAirdropsForUser(userId int, now int64) ([]WelfareAirdropView, error) {
	airdrops, err := model.GetActiveWelfareAirdrops(now)
	if err != nil {
		return nil, err
	}

	ids := make([]int, 0, len(airdrops))
	for _, airdrop := range airdrops {
		ids = append(ids, airdrop.Id)
	}
	claimedByAirdrop, err := model.CountUserWelfareAirdropClaimsByAirdrop(userId, ids)
	if err != nil {
		return nil, err
	}

	views := make([]WelfareAirdropView, 0, len(airdrops))
	for _, airdrop := range airdrops {
		view := buildWelfareAirdropView(airdrop, claimedByAirdrop[airdrop.Id], now)
		// 用户端只展示「即将开始」和「可领取」的活动；已领取、已领完、已结束的
		// 活动不再出现在空投页，历史领取可在领取记录中追溯。
		if view.State != WelfareAirdropStateUpcoming && view.State != WelfareAirdropStateActive {
			continue
		}
		views = append(views, view)
	}
	return views, nil
}

func buildWelfareAirdropView(airdrop *model.WelfareAirdrop, claimedByMe int, now int64) WelfareAirdropView {
	perUserLimit := airdrop.PerUserLimit
	if perUserLimit < 1 {
		perUserLimit = 1
	}
	unlimited := airdrop.TotalCount == model.WelfareAirdropUnlimitedStock

	remaining := 0
	if !unlimited {
		remaining = airdrop.TotalCount - airdrop.ClaimedCount
		if remaining < 0 {
			remaining = 0
		}
	}

	view := WelfareAirdropView{
		Id:           airdrop.Id,
		Name:         airdrop.Name,
		Description:  airdrop.Description,
		Quota:        airdrop.Quota,
		TotalCount:   airdrop.TotalCount,
		ClaimedCount: airdrop.ClaimedCount,
		Remaining:    remaining,
		Unlimited:    unlimited,
		PerUserLimit: perUserLimit,
		ClaimedByMe:  claimedByMe,
		StartTime:    airdrop.StartTime,
		EndTime:      airdrop.EndTime,
		BatchId:      airdrop.BatchId,
	}

	switch err := airdrop.Claimable(now); {
	case errors.Is(err, model.ErrWelfareAirdropNotStarted):
		view.State = WelfareAirdropStateUpcoming
	case errors.Is(err, model.ErrWelfareAirdropEnded):
		view.State = WelfareAirdropStateEnded
	case errors.Is(err, model.ErrWelfareAirdropSoldOut):
		view.State = WelfareAirdropStateSoldOut
	case err != nil:
		view.State = WelfareAirdropStateEnded
	case claimedByMe >= perUserLimit:
		view.State = WelfareAirdropStateClaimed
	default:
		view.State = WelfareAirdropStateActive
		view.CanClaim = true
	}
	return view
}

// ClaimWelfareAirdrop 为用户领取一份空投，成功后返回本次签发的兑换码记录。
func ClaimWelfareAirdrop(airdropId int, userId int, now int64) (*WelfareAirdropClaimView, error) {
	claim, err := model.ClaimWelfareAirdrop(airdropId, userId, now)
	if err != nil {
		return nil, err
	}
	view := toWelfareAirdropClaimView(claim)
	return &view, nil
}

// ListWelfareAirdropClaims 返回用户最近的领取历史（最新在前，最多 10 条）。
func ListWelfareAirdropClaims(userId int) ([]WelfareAirdropClaimView, error) {
	claims, err := model.GetUserWelfareAirdropClaims(userId, WelfareAirdropClaimHistoryLimit)
	if err != nil {
		return nil, err
	}
	views := make([]WelfareAirdropClaimView, 0, len(claims))
	for _, claim := range claims {
		views = append(views, toWelfareAirdropClaimView(claim))
	}
	return views, nil
}

// ListAllWelfareAirdrops 返回全部活动，供管理端维护。
func ListAllWelfareAirdrops() ([]*model.WelfareAirdrop, error) {
	return model.GetAllWelfareAirdrops()
}

// ValidateWelfareAirdrop 收敛管理员提交的活动配置。额度与份数是发放乘数，必须在
// 落库前限定范围，否则领取时的额度计算会被推到 int32 饱和边界。
func ValidateWelfareAirdrop(airdrop *model.WelfareAirdrop) error {
	nameLength := utf8.RuneCountInString(airdrop.Name)
	if nameLength == 0 || nameLength > MaxWelfareAirdropNameLength {
		return ErrWelfareAirdropNameLength
	}
	if utf8.RuneCountInString(airdrop.Description) > MaxWelfareAirdropDescriptionLength {
		return ErrWelfareAirdropDescLength
	}
	if airdrop.Quota <= 0 || airdrop.Quota > common.MaxQuota {
		return ErrWelfareAirdropQuotaRange
	}
	if airdrop.TotalCount < 0 || airdrop.TotalCount > MaxWelfareAirdropTotalCount {
		return ErrWelfareAirdropCountRange
	}
	if airdrop.PerUserLimit < 1 || airdrop.PerUserLimit > MaxWelfareAirdropPerUserLimit {
		return ErrWelfareAirdropLimitRange
	}
	if airdrop.StartTime < 0 || airdrop.EndTime < 0 {
		return ErrWelfareAirdropTimeInvalid
	}
	if airdrop.StartTime != 0 && airdrop.EndTime != 0 && airdrop.EndTime <= airdrop.StartTime {
		return ErrWelfareAirdropTimeInvalid
	}
	if airdrop.Status != model.WelfareAirdropStatusEnabled && airdrop.Status != model.WelfareAirdropStatusDisabled {
		return ErrWelfareAirdropStatusInvald
	}
	return nil
}

// CreateWelfareAirdrop 校验并新建一场活动。
func CreateWelfareAirdrop(airdrop *model.WelfareAirdrop, creatorId int, now int64) error {
	if airdrop.Status == 0 {
		airdrop.Status = model.WelfareAirdropStatusEnabled
	}
	if airdrop.PerUserLimit == 0 {
		airdrop.PerUserLimit = 1
	}
	if airdrop.BatchId == "" {
		airdrop.BatchId = common.GetUUID()
	}
	if err := ValidateWelfareAirdrop(airdrop); err != nil {
		return err
	}
	airdrop.ClaimedCount = 0
	airdrop.CreatorId = creatorId
	airdrop.CreatedTime = now
	airdrop.UpdatedTime = now
	return airdrop.Insert()
}

// UpdateWelfareAirdrop 校验并保存一场已存在活动的可编辑字段。
func UpdateWelfareAirdrop(airdrop *model.WelfareAirdrop, now int64) error {
	existing, err := model.GetWelfareAirdropById(airdrop.Id)
	if err != nil {
		return err
	}
	if airdrop.Status == 0 {
		airdrop.Status = existing.Status
	}
	if airdrop.PerUserLimit == 0 {
		airdrop.PerUserLimit = existing.PerUserLimit
	}
	if err := ValidateWelfareAirdrop(airdrop); err != nil {
		return err
	}
	airdrop.UpdatedTime = now
	return airdrop.Update()
}

// RemoveWelfareAirdrop 删除一场活动。
func RemoveWelfareAirdrop(id int) error {
	return model.DeleteWelfareAirdropById(id)
}
