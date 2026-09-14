package service

import (
	"errors"
	"net/url"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
)

// 合作申请的配置边界。这些都是防滥用上限而非计费乘数，合作申请链路完全不触碰
// 额度，因此不涉及额度饱和 / QuotaFromFloat 那套约束。
const (
	MaxCooperationSiteNameLength             = 50                                            // 站点名称字符数上限（Unicode 码点）
	MaxCooperationSiteUrlLength              = 200                                           // 站点地址字符数上限（Unicode 码点）
	MaxCooperationDescriptionLength          = 500                                           // 站点简介字符数上限（Unicode 码点）
	MaxCooperationAudienceLength             = 100                                           // 受众规模描述字符数上限（Unicode 码点）
	MaxCooperationContactLength              = 100                                           // 联系方式字符数上限（Unicode 码点）
	MaxCooperationNotesLength                = 500                                           // 补充说明字符数上限（Unicode 码点）
	MaxCooperationReviewNoteLength           = 500                                           // 管理员审核备注字符数上限（Unicode 码点）
	MaxCooperationPendingPerUser             = 1                                             // 单用户同时待审核的申请数上限
	MaxCooperationPerUserPerDay              = 3                                             // 单用户每日提交申请数上限
	MaxCooperationSiteEntryNameLength        = 50                                            // 合作站点条目的站点名称字符数上限（Unicode 码点）
	MaxCooperationSiteEntryUrlLength         = 200                                           // 合作站点条目的链接 / 图片链接字符数上限（Unicode 码点）
	MaxCooperationSiteEntryDescriptionLength = model.MaxCooperationSiteEntryDescriptionRunes // 合作站点条目的站点简介字符数上限（Unicode 码点），与审批自动同步时的截断上限同源
)

// 合作方式的默认全集与启用配置见 setting/cooperation_method.go：
// 管理员可在系统设置中增删自定义方式（CooperationMethodsAdmin，元素为
// {id,label} 对象或旧格式字符串 id），用户提交的每个方式标识都必须落在
// 当前开放集合内。

// 站点类型标识白名单，与前端 features/cooperation/constants.ts 保持同一份取值，
// 存入 site_type 列。
var cooperationSiteTypeKeys = []string{
	"blog",        // 个人博客
	"forum",       // 论坛社区
	"tool",        // 工具站点
	"channel",     // 视频/自媒体频道
	"team",        // 开发团队
	"open_source", // 开源项目
	"relay",       // 中转站
	"other",       // 其他
}

var (
	ErrCooperationDisabled           = errors.New("合作推广功能当前未开启")
	ErrCooperationSiteNameLength     = errors.New("站点名称长度必须在 1 到 50 个字符之间")
	ErrCooperationSiteUrlInvalid     = errors.New("站点地址必须是合法的 http(s) 链接")
	ErrCooperationSiteTypeInvalid    = errors.New("无效的站点类型")
	ErrCooperationDescriptionLength  = errors.New("站点简介长度必须在 1 到 500 个字符之间")
	ErrCooperationAudienceLength     = errors.New("受众规模不能超过 100 个字符")
	ErrCooperationMethodInvalid      = errors.New("请至少选择一种有效的合作方式")
	ErrCooperationContactLength      = errors.New("联系方式长度必须在 1 到 100 个字符之间")
	ErrCooperationNotesLength        = errors.New("补充说明不能超过 500 个字符")
	ErrCooperationReviewNoteLength   = errors.New("审核备注不能超过 500 个字符")
	ErrCooperationRejectNoteRequired = errors.New("驳回申请时必须填写原因")

	ErrCooperationSiteEntryNameLength        = errors.New("站点名称长度必须在 1 到 50 个字符之间")
	ErrCooperationSiteEntryUrlInvalid        = errors.New("站点链接必须是合法的 http(s) 链接")
	ErrCooperationSiteEntryImageInvalid      = errors.New("Logo 与轮播图必须是合法的 http(s) 链接")
	ErrCooperationSiteEntryDescriptionLength = errors.New("站点简介不能超过 200 个字符")

	ErrCooperationSiteBannerInvalid = errors.New("网站封面图必须是合法的 http(s) 图片链接")
	ErrCooperationMethodDisabled    = errors.New("该合作方式当前未开放，请从开放的合作方式中选择")
)

// CooperationApplicationInput 是用户提交合作申请的请求体，进入
// ValidateCooperationApplicationInput 校验后才允许落库。
type CooperationApplicationInput struct {
	SiteName    string   `json:"site_name"`   // 站点名称
	SiteUrl     string   `json:"site_url"`    // 站点地址
	SiteBanner  string   `json:"site_banner"` // 网站封面图 URL，可选
	SiteType    string   `json:"site_type"`   // 站点类型标识
	Description string   `json:"description"` // 站点简介
	Audience    string   `json:"audience"`    // 受众规模描述，可选
	Methods     []string `json:"methods"`     // 合作方式标识列表
	Contact     string   `json:"contact"`     // 联系方式
	Notes       string   `json:"notes"`       // 补充说明
}

// isValidHttpUrl 判断是否为带 host 的 http(s) 链接且不超过字符上限。
func isValidHttpUrl(value string, maxRunes int) bool {
	if utf8.RuneCountInString(value) > maxRunes {
		return false
	}
	parsedUrl, err := url.Parse(value)
	if err != nil {
		return false
	}
	return (parsedUrl.Scheme == "http" || parsedUrl.Scheme == "https") && parsedUrl.Host != ""
}

// ValidateCooperationApplicationInput 归一化并校验用户提交的合作申请。
// 长度一律按 Unicode 码点计数（utf8.RuneCountInString），与中文「N 个字」语义
// 一致；多行文本（简介 / 备注）复用工单的 CRLF 归一化，保证前端字数计数与
// 后端一致。返回填好站点信息字段的模型行（审核字段由模型层初始化）。
func ValidateCooperationApplicationInput(input *CooperationApplicationInput) (*model.CooperationApplication, error) {
	siteName := strings.TrimSpace(input.SiteName)
	if length := utf8.RuneCountInString(siteName); length == 0 || length > MaxCooperationSiteNameLength {
		return nil, ErrCooperationSiteNameLength
	}

	siteUrl := strings.TrimSpace(input.SiteUrl)
	if !isValidHttpUrl(siteUrl, MaxCooperationSiteUrlLength) {
		return nil, ErrCooperationSiteUrlInvalid
	}

	siteBanner := strings.TrimSpace(input.SiteBanner)
	if siteBanner != "" && !isValidHttpUrl(siteBanner, MaxCooperationSiteUrlLength) {
		return nil, ErrCooperationSiteBannerInvalid
	}

	siteType := strings.TrimSpace(input.SiteType)
	if !slices.Contains(cooperationSiteTypeKeys, siteType) {
		return nil, ErrCooperationSiteTypeInvalid
	}

	description := NormalizeTicketContent(input.Description)
	if length := utf8.RuneCountInString(description); length == 0 || length > MaxCooperationDescriptionLength {
		return nil, ErrCooperationDescriptionLength
	}

	audience := strings.TrimSpace(input.Audience)
	if utf8.RuneCountInString(audience) > MaxCooperationAudienceLength {
		return nil, ErrCooperationAudienceLength
	}

	// 合作方式：每项都必须在管理员当前开放的集合内（内置 + 自定义，
	// 见 setting.GetEnabledCooperationMethodIds），去重后至少保留一项；
	// 顺序保持用户勾选顺序
	enabledMethods := setting.GetEnabledCooperationMethodIds()
	methods := make([]string, 0, len(input.Methods))
	for _, method := range input.Methods {
		method = strings.TrimSpace(method)
		if method == "" {
			return nil, ErrCooperationMethodInvalid
		}
		if !slices.Contains(enabledMethods, method) {
			return nil, ErrCooperationMethodDisabled
		}
		if !slices.Contains(methods, method) {
			methods = append(methods, method)
		}
	}
	if len(methods) == 0 {
		return nil, ErrCooperationMethodInvalid
	}
	methodsJson, err := common.Marshal(methods)
	if err != nil {
		return nil, err
	}

	contact := strings.TrimSpace(input.Contact)
	if length := utf8.RuneCountInString(contact); length == 0 || length > MaxCooperationContactLength {
		return nil, ErrCooperationContactLength
	}

	notes := NormalizeTicketContent(input.Notes)
	if length := utf8.RuneCountInString(notes); length > MaxCooperationNotesLength {
		return nil, ErrCooperationNotesLength
	}

	return &model.CooperationApplication{
		SiteName:    siteName,
		SiteUrl:     siteUrl,
		SiteBanner:  siteBanner,
		SiteType:    siteType,
		Description: description,
		Audience:    audience,
		Methods:     string(methodsJson),
		Contact:     contact,
		Notes:       notes,
	}, nil
}

// ValidateCooperationReviewNote 归一化并校验管理员审核备注。驳回时必须填写
// 原因（申请人需要知道为何被驳回），通过时备注可空。
func ValidateCooperationReviewNote(note string, targetStatus int) (string, error) {
	note = strings.TrimSpace(note)
	if utf8.RuneCountInString(note) > MaxCooperationReviewNoteLength {
		return "", ErrCooperationReviewNoteLength
	}
	if targetStatus == model.CooperationStatusRejected && note == "" {
		return "", ErrCooperationRejectNoteRequired
	}
	return note, nil
}

// CreateCooperationApplicationForUser 校验并落库一条待审核的合作申请。
// moduleEnabled 反映用户端模块开关（管理员级侧边栏模块配置），由调用方传入。
func CreateCooperationApplicationForUser(userId int, username string, input *CooperationApplicationInput, moduleEnabled bool, dayStart int64, now int64) (*model.CooperationApplication, error) {
	if !moduleEnabled {
		return nil, ErrCooperationDisabled
	}
	app, err := ValidateCooperationApplicationInput(input)
	if err != nil {
		return nil, err
	}
	app.UserId = userId
	app.Username = username
	if err := model.CreateCooperationApplication(app, MaxCooperationPendingPerUser, MaxCooperationPerUserPerDay, dayStart, now); err != nil {
		return nil, err
	}
	return app, nil
}

// ListCooperationApplicationsForUser 返回当前用户自己的全部申请，按 ID 倒序。
func ListCooperationApplicationsForUser(userId int) ([]*model.CooperationApplication, error) {
	return model.GetCooperationApplicationsByUserId(userId)
}

// CooperationStatsView 是管理端的合作申请概览。pending 即待办队列长度，
// 驱动侧边栏红点。
type CooperationStatsView struct {
	Pending  int64 `json:"pending"`  // 待审核
	Approved int64 `json:"approved"` // 已通过
	Rejected int64 `json:"rejected"` // 已驳回
	Total    int64 `json:"total"`
}

// GetCooperationStats 汇总各状态申请数。
func GetCooperationStats() (*CooperationStatsView, error) {
	counts, err := model.GetCooperationStatusCounts()
	if err != nil {
		return nil, err
	}
	stats := &CooperationStatsView{}
	for status, count := range counts {
		stats.Total += count
		switch status {
		case model.CooperationStatusPending:
			stats.Pending = count
		case model.CooperationStatusApproved:
			stats.Approved = count
		case model.CooperationStatusRejected:
			stats.Rejected = count
		}
	}
	return stats, nil
}

// CooperationSiteInput 是管理端创建 / 更新合作站点展示条目的请求体。
// Id 仅更新时使用（新建忽略）；Enabled 用指针区分「未传」与显式 false，
// 新建时缺省为 true；SiteType 可选，空串表示不展示类型标签。
type CooperationSiteInput struct {
	Id          int    `json:"id"`
	Name        string `json:"name"`
	Url         string `json:"url"`
	Logo        string `json:"logo"`
	Banner      string `json:"banner"`
	SiteType    string `json:"site_type"`
	Description string `json:"description"`
	Featured    bool   `json:"featured"`
	Sort        int    `json:"sort"`
	Enabled     *bool  `json:"enabled"`
}

// ValidateCooperationSiteInput 归一化并校验合作站点展示条目。
// Logo 与轮播图（Banner）可选，填了就必须是合法的 http(s) 链接；
// Featured / Sort 决定公共页面的轮播与排序展示。
func ValidateCooperationSiteInput(input *CooperationSiteInput) (*model.CooperationSite, error) {
	name := strings.TrimSpace(input.Name)
	if length := utf8.RuneCountInString(name); length == 0 || length > MaxCooperationSiteEntryNameLength {
		return nil, ErrCooperationSiteEntryNameLength
	}

	siteUrl := strings.TrimSpace(input.Url)
	if !isValidHttpUrl(siteUrl, MaxCooperationSiteEntryUrlLength) {
		return nil, ErrCooperationSiteEntryUrlInvalid
	}

	logo := strings.TrimSpace(input.Logo)
	if logo != "" && !isValidHttpUrl(logo, MaxCooperationSiteEntryUrlLength) {
		return nil, ErrCooperationSiteEntryImageInvalid
	}

	banner := strings.TrimSpace(input.Banner)
	if banner != "" && !isValidHttpUrl(banner, MaxCooperationSiteEntryUrlLength) {
		return nil, ErrCooperationSiteEntryImageInvalid
	}

	siteType := strings.TrimSpace(input.SiteType)
	if siteType != "" && !slices.Contains(cooperationSiteTypeKeys, siteType) {
		return nil, ErrCooperationSiteTypeInvalid
	}

	description := strings.TrimSpace(input.Description)
	if length := utf8.RuneCountInString(description); length > MaxCooperationSiteEntryDescriptionLength {
		return nil, ErrCooperationSiteEntryDescriptionLength
	}

	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	return &model.CooperationSite{
		Id:          input.Id,
		Name:        name,
		Url:         siteUrl,
		Logo:        logo,
		Banner:      banner,
		SiteType:    siteType,
		Description: description,
		Featured:    input.Featured,
		Sort:        input.Sort,
		Enabled:     enabled,
	}, nil
}
