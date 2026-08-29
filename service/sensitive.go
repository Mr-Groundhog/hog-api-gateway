package service

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting"

	"gorm.io/gorm"
)

// BanUserForSensitiveWords 禁用累计触发敏感词达到阈值的用户，封禁原因写入 prohibited_words，
// 并同步失效浏览器会话、令牌缓存与鉴权缓存，使后续并发请求在鉴权关卡即被拒绝。
func BanUserForSensitiveWords(userId int) error {
	err := model.DB.Model(&model.User{}).Where("id = ?", userId).Updates(map[string]interface{}{
		"status":       common.UserStatusDisabled,
		"ban_reason":   model.UserBanReasonProhibitedWords,
		"auth_version": gorm.Expr("auth_version + 1"),
	}).Error
	if err != nil {
		return err
	}
	_, _ = model.RevokeAllUserSessions(userId, "user_security_changed")
	_ = model.InvalidateUserTokensCache(userId)
	_ = model.PublishUserAuthCache(userId)
	return nil
}

func CheckSensitiveMessages(messages []dto.Message) ([]string, error) {
	if len(messages) == 0 {
		return nil, nil
	}

	for _, message := range messages {
		arrayContent := message.ParseContent()
		for _, m := range arrayContent {
			if m.Type == "image_url" {
				// TODO: check image url
				continue
			}
			// 检查 text 是否为空
			if m.Text == "" {
				continue
			}
			if ok, words := SensitiveWordContains(m.Text); ok {
				return words, errors.New("sensitive words detected")
			}
		}
	}
	return nil, nil
}

func CheckSensitiveText(text string) (bool, []string) {
	return SensitiveWordContains(text)
}

// SensitiveWordContains 是否包含敏感词，返回是否包含敏感词和敏感词列表。
// 纯英文（ASCII 字母/数字/下划线）敏感词按整词匹配，避免 "hi"、"hello" 这类短词
// 命中 this、which、machine 等普通单词的子串；其余敏感词仍按子串匹配。
func SensitiveWordContains(text string) (bool, []string) {
	if len(setting.SensitiveWords) == 0 {
		return false, nil
	}
	if len(text) == 0 {
		return false, nil
	}
	checkText := strings.ToLower(text)
	return searchSensitive(checkText, setting.SensitiveWords, true)
}

// searchSensitive 基于 AC 自动机搜索敏感词，对纯英文敏感词执行整词匹配。
func searchSensitive(findText string, dict []string, stopImmediately bool) (bool, []string) {
	m := getOrBuildAC(dict)
	if m == nil {
		return false, nil
	}
	runes := []rune(findText)
	// Boundary validation happens after the AC search. Do not let the matcher stop
	// at the first raw hit, because that hit may be an invalid ASCII substring
	// (for example, "hi" in "this") while a later whole-word hit is valid.
	hits := m.MultiPatternSearch(runes, false)
	if len(hits) == 0 {
		return false, nil
	}
	words := make([]string, 0, len(hits))
	seen := make(map[string]struct{}, len(hits))
	for _, hit := range hits {
		word := string(hit.Word)
		if _, ok := seen[word]; ok {
			continue
		}
		if isPureAsciiWord(word) && !isWordBoundaryHit(runes, hit.Pos, len(hit.Word)) {
			continue
		}
		seen[word] = struct{}{}
		words = append(words, word)
		if stopImmediately {
			return true, words
		}
	}
	if len(words) == 0 {
		return false, nil
	}
	return true, words
}

// isPureAsciiWord 判断单词是否由纯 ASCII 字母、数字、下划线组成。
func isPureAsciiWord(word string) bool {
	if word == "" {
		return false
	}
	for _, c := range word {
		if !isAsciiWordChar(c) {
			return false
		}
	}
	return true
}

// isWordBoundaryHit 判断从 pos 开始、长度为 length 的命中是否满足整词边界：
// 命中位置前后均不能是 ASCII 字母/数字/下划线。
func isWordBoundaryHit(text []rune, pos, length int) bool {
	if pos > 0 && isAsciiWordChar(text[pos-1]) {
		return false
	}
	end := pos + length
	if end < len(text) && isAsciiWordChar(text[end]) {
		return false
	}
	return true
}

func isAsciiWordChar(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_'
}

// SensitiveWordReplace 敏感词替换，返回是否包含敏感词和替换后的文本
func SensitiveWordReplace(text string, returnImmediately bool) (bool, []string, string) {
	if len(setting.SensitiveWords) == 0 {
		return false, nil, text
	}
	checkText := strings.ToLower(text)
	m := getOrBuildAC(setting.SensitiveWords)
	hits := m.MultiPatternSearch([]rune(checkText), returnImmediately)
	if len(hits) > 0 {
		words := make([]string, 0, len(hits))
		var builder strings.Builder
		builder.Grow(len(text))
		lastPos := 0

		for _, hit := range hits {
			pos := hit.Pos
			word := string(hit.Word)
			builder.WriteString(text[lastPos:pos])
			builder.WriteString("**###**")
			lastPos = pos + len(word)
			words = append(words, word)
		}
		builder.WriteString(text[lastPos:])
		return true, words, builder.String()
	}
	return false, nil, text
}
