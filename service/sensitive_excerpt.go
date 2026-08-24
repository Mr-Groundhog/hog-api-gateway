package service

import (
	"sort"
	"strings"
	"unicode/utf8"
)

// SensitiveWordExcerptLimit 是违规记录中请求内容的最大存储字节数。
const SensitiveWordExcerptLimit = 20000

// sensitiveWordExcerptContext 是摘录里命中词两侧各保留的上下文字节数。
const sensitiveWordExcerptContext = 500

// sensitiveWordExcerptElision 标记摘录中被省略的内容。
const sensitiveWordExcerptElision = "\n[…]\n"

// SensitiveWordMatch 描述命中词在留证摘录中的位置。
type SensitiveWordMatch struct {
	// Word 是命中的敏感词。
	Word string `json:"word"`
	// Start 是命中词在摘录中的字符（rune）偏移，未出现在摘录中时为 -1。
	Start int `json:"start"`
}

// BuildSensitiveWordExcerpt 为违规记录生成请求内容摘录，并给出每个命中词在摘录中的首次位置。
// 超长内容不能直接截取开头：命中词常位于文本后段，被切掉后后台会出现"标记了命中词、
// 但请求内容里找不到"的记录。摘录始终围绕命中词展开，因此命中词一定可见。
// limit <= 0 表示不限制长度。
func BuildSensitiveWordExcerpt(text string, words []string, limit int) (string, []SensitiveWordMatch) {
	excerpt := text
	if limit > 0 && len(text) > limit {
		excerpt = sensitiveWordExcerpt(text, words, limit)
	}
	matches := make([]SensitiveWordMatch, 0, len(words))
	for _, word := range words {
		start := -1
		if spans := sensitiveWordByteSpans(excerpt, []string{word}); len(spans) > 0 {
			start = utf8.RuneCountInString(excerpt[:spans[0][0]])
		}
		matches = append(matches, SensitiveWordMatch{Word: word, Start: start})
	}
	return excerpt, matches
}

// sensitiveWordExcerptContext 之外，紧凑模式为每个命中词额外保留的上下文字节数。
// 当完整上下文窗口超出预算时，退化为只保留命中词本身加这段极短上下文，确保命中词可见。
const sensitiveWordExcerptCompactContext = 16

// sensitiveWordExcerpt 拼接命中词的上下文窗口，窗口之间用省略标记分隔，总长度不超过 limit。
// 预算耗尽时不会整块丢弃命中词：放不下的窗口退化为紧凑模式（仅命中词本身加极短上下文），
// 以保证每条被标记的敏感词在留证内容里都至少出现一次。
func sensitiveWordExcerpt(text string, words []string, limit int) string {
	raw := sensitiveWordByteSpans(text, words)
	if len(raw) == 0 {
		return text[:alignRuneBoundary(text, limit)] + sensitiveWordExcerptElision
	}
	windows := sensitiveWordExcerptWindows(text, raw)

	var builder strings.Builder
	builder.Grow(limit + 2*len(sensitiveWordExcerptElision))
	used, prevEnd, emitted := 0, 0, false
	for _, window := range windows {
		gap := ""
		if window[0] > prevEnd {
			gap = sensitiveWordExcerptElision
		}
		room := limit - used - len(gap)
		if room <= 0 {
			// 预算耗尽：尝试紧凑模式保住本窗口内的命中词，否则停止。
			if compact := compactSpans(text, raw, window, room); compact != "" {
				builder.WriteString(gap)
				builder.WriteString(compact)
				used += len(gap) + len(compact)
				emitted = true
			}
			break
		}
		piece := text[window[0]:window[1]]
		// 首个窗口预算不足时按字符边界裁短，保住第一个命中词。
		if len(piece) > room {
			if emitted {
				if compact := compactSpans(text, raw, window, room); compact != "" {
					builder.WriteString(gap)
					builder.WriteString(compact)
					used += len(gap) + len(compact)
				}
				break
			}
			piece = piece[:alignRuneBoundary(piece, room)]
		}
		builder.WriteString(gap)
		builder.WriteString(piece)
		used += len(gap) + len(piece)
		prevEnd = window[0] + len(piece)
		emitted = true
		if len(piece) > room {
			break
		}
	}
	if prevEnd < len(text) {
		builder.WriteString(sensitiveWordExcerptElision)
	}
	return builder.String()
}

// compactSpans 在预算 room 内，把落在 window 范围内的命中词以紧凑形式拼出：
// 每个命中词保留自身加前后极短上下文。返回空串表示预算完全不够。
func compactSpans(text string, raw [][2]int, window [2]int, room int) string {
	var builder strings.Builder
	used := 0
	prevEnd := window[0]
	for _, span := range raw {
		if span[1] <= window[0] || span[0] >= window[1] {
			continue
		}
		start := alignRuneBoundary(text, max(span[0]-sensitiveWordExcerptCompactContext, 0))
		end := alignRuneBoundary(text, min(span[1]+sensitiveWordExcerptCompactContext, len(text)))
		gap := ""
		if start > prevEnd {
			gap = sensitiveWordExcerptElision
		}
		need := len(gap) + (end - start)
		if used+need > room {
			break
		}
		builder.WriteString(gap)
		builder.WriteString(text[start:end])
		used += need
		prevEnd = end
	}
	return builder.String()
}

// sensitiveWordExcerptWindows 返回按位置升序、互不重叠的命中词上下文窗口（字节区间）。
func sensitiveWordExcerptWindows(text string, raw [][2]int) [][2]int {
	windows := make([][2]int, 0, len(raw))
	for _, span := range raw {
		start := alignRuneBoundary(text, max(span[0]-sensitiveWordExcerptContext, 0))
		end := alignRuneBoundary(text, min(span[1]+sensitiveWordExcerptContext, len(text)))
		if last := len(windows) - 1; last >= 0 && start <= windows[last][1] {
			windows[last][1] = max(windows[last][1], end)
			continue
		}
		windows = append(windows, [2]int{start, end})
	}
	return windows
}

// sensitiveWordByteSpans 按位置升序返回全部命中词出现的字节区间。匹配规则与检测器
// SensitiveWordContains 保持一致：忽略大小写，纯 ASCII 敏感词只在整词边界处命中。
func sensitiveWordByteSpans(text string, words []string) [][2]int {
	lowered := strings.ToLower(text)
	// 少数字符转小写后字节长度会变，导致偏移整体错位；这种情况退回大小写敏感匹配。
	foldCase := len(lowered) == len(text)
	haystack := text
	if foldCase {
		haystack = lowered
	}

	spans := make([][2]int, 0, len(words))
	for _, word := range words {
		needle := word
		if foldCase {
			needle = strings.ToLower(needle)
		}
		if needle == "" {
			continue
		}
		wholeWordOnly := isPureAsciiWord(needle)
		for from := 0; from+len(needle) <= len(haystack); {
			offset := strings.Index(haystack[from:], needle)
			if offset < 0 {
				break
			}
			start := from + offset
			end := start + len(needle)
			if !wholeWordOnly || isAsciiWordBoundaryAt(haystack, start, end) {
				spans = append(spans, [2]int{start, end})
			}
			from = start + 1
		}
	}
	sort.Slice(spans, func(i, j int) bool { return spans[i][0] < spans[j][0] })
	return spans
}

// isAsciiWordBoundaryAt 判断字节区间 [start, end) 前后是否都不是 ASCII 单词字符，
// 与 isWordBoundaryHit 规则相同，只是工作在字节偏移上。多字节字符的每个字节都
// >= 0x80，天然构成边界。
func isAsciiWordBoundaryAt(text string, start, end int) bool {
	if start > 0 && isAsciiWordChar(rune(text[start-1])) {
		return false
	}
	if end < len(text) && isAsciiWordChar(rune(text[end])) {
		return false
	}
	return true
}

// alignRuneBoundary 把字节位置回退到最近的 UTF-8 字符起始处。按字节硬切会切出半个字符，
// PostgreSQL 会直接拒绝写入（invalid byte sequence for encoding "UTF8"），
// MySQL utf8mb4 严格模式同样报错，导致整条违规记录丢失。
func alignRuneBoundary(text string, pos int) int {
	if pos <= 0 {
		return 0
	}
	if pos >= len(text) {
		return len(text)
	}
	for pos > 0 && text[pos]&0xC0 == 0x80 {
		pos--
	}
	return pos
}
