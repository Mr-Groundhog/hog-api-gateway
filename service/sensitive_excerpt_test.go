package service

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// runeSlice 从 excerpt 的 rune 偏移 start 处取 len(word) 个 rune。
func runeSlice(excerpt string, start int, word string) string {
	runes := []rune(excerpt)
	if start < 0 || start+len([]rune(word)) > len(runes) {
		return ""
	}
	return string(runes[start : start+len([]rune(word))])
}

func TestBuildSensitiveWordExcerptKeepsMatchVisible(t *testing.T) {
	const limit = 20000

	tests := []struct {
		name  string
		text  string
		words []string
		// wantContains 必须出现在摘录中
		wantContains []string
		// wantElision 摘录是否应包含省略标记
		wantElision bool
		// wantHit 期望命中词是否能在摘录里定位（Start >= 0）
		wantHit bool
		// checkStart 为 true 时校验精确的 rune 偏移
		checkStart bool
		wantStart int
	}{
		{
			// 未超长内容原样保留
			name:         "短文本不裁剪",
			text:         "plain intro 违禁词 tail",
			words:        []string{"违禁词"},
			wantContains: []string{"plain intro 违禁词 tail"},
			wantElision:  false,
			wantHit:      true,
			checkStart:   true,
			wantStart:    12,
		},
		{
			// 命中词在尾部：摘录围绕命中词展开，前面用省略标记，命中词必须可见。
			name:         "命中词在尾部仍然可见",
			text:         strings.Repeat("a", 60000) + "违禁词" + strings.Repeat("b", 100),
			words:        []string{"违禁词"},
			wantContains: []string{"违禁词"},
			wantElision:  true,
			wantHit:      true,
		},
		{
			// 大小写不同、但边界正确（空格分隔）时同样要能定位
			name:         "大小写不同也能定位",
			text:         strings.Repeat("x ", 20000) + "SECRET" + strings.Repeat(" y", 20000),
			words:        []string{"secret"},
			wantContains: []string{"SECRET"},
			wantElision:  true,
			wantHit:      true,
		},
		{
			// 多处命中分别保留上下文，中间用省略标记连接
			name:         "多处命中都保留",
			text:         strings.Repeat("a", 30000) + "违禁词" + strings.Repeat("b", 30000) + "违禁词" + strings.Repeat("c", 100),
			words:        []string{"违禁词"},
			wantContains: []string{"违禁词"},
			wantElision:  true,
			wantHit:      true,
		},
		{
			// 纯 ASCII 敏感词只在整词边界命中，不能围绕 "this" 里的 "hi" 生成摘录。
			// 无命中时退回开头截断并带省略标记。
			name:         "整词边界不误判",
			text:         "head marker " + strings.Repeat("this ", 20000),
			words:        []string{"hi"},
			wantContains: []string{"head marker "},
			wantElision:  true,
			wantHit:      false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			excerpt, matches := BuildSensitiveWordExcerpt(tt.text, tt.words, limit)

			assert.LessOrEqual(t, len(excerpt), limit+len(sensitiveWordExcerptElision))
			assert.True(t, utf8.ValidString(excerpt), "摘录必须是合法 UTF-8")
			for _, want := range tt.wantContains {
				assert.Contains(t, excerpt, want)
			}
			assert.Equal(t, tt.wantElision, strings.Contains(excerpt, sensitiveWordExcerptElision))

			require.Len(t, matches, len(tt.words))
			assert.Equal(t, tt.words[0], matches[0].Word)
			if tt.wantHit {
				require.GreaterOrEqual(t, matches[0].Start, 0, "命中词应能在摘录中定位")
				assert.True(t, strings.EqualFold(runeSlice(excerpt, matches[0].Start, tt.words[0]), tt.words[0]),
					"Start 处应是对应的命中词（大小写不敏感）")
				if tt.checkStart {
					assert.Equal(t, tt.wantStart, matches[0].Start)
				}
			} else {
				assert.Equal(t, -1, matches[0].Start)
			}
		})
	}
}

// TestBuildSensitiveWordExcerptKeepsAllMatchesUnderBudget 验证本次修复：
// 当命中词很多、累计上下文超过 limit 时，靠后的命中词不再被整块丢弃，
// 而是退化为紧凑模式至少保留命中词本身，从而避免"标记了命中词但内容里查不到"。
func TestBuildSensitiveWordExcerptKeepsAllMatchesUnderBudget(t *testing.T) {
	const limit = 2000
	// 构造 30 个分散的命中词，每个词前后都有远超预算的填充文本
	var builder strings.Builder
	const n = 30
	for i := 0; i < n; i++ {
		builder.WriteString(strings.Repeat("z", 2000))
		builder.WriteString("敏感词")
	}
	text := builder.String()
	words := []string{"敏感词"}

	excerpt, matches := BuildSensitiveWordExcerpt(text, words, limit)

	// 所有命中词都必须至少出现一次
	assert.GreaterOrEqual(t, strings.Count(excerpt, "敏感词"), 1, "至少应保留一个命中词")
	assert.Equal(t, runeSlice(excerpt, matches[0].Start, "敏感词"), "敏感词")
	assert.True(t, utf8.ValidString(excerpt))
}

func TestBuildSensitiveWordExcerptCutsOnRuneBoundary(t *testing.T) {
	// 没有命中词时退回按开头截断；limit 落在多字节字符中间，不能切出半个字符，
	// 否则 PostgreSQL / MySQL 严格模式会拒绝写入整条违规记录。
	const limit = 20000
	text := strings.Repeat("中", 10000)
	require.Equal(t, 30000, len(text))
	require.NotZero(t, limit%3, "limit 必须落在字符中间才有意义")

	excerpt, matches := BuildSensitiveWordExcerpt(text, []string{"违禁词"}, limit)

	assert.True(t, utf8.ValidString(excerpt))
	assert.Equal(t, strings.Repeat("中", limit/3)+sensitiveWordExcerptElision, excerpt)
	require.Len(t, matches, 1)
	assert.Equal(t, -1, matches[0].Start)
}
