package service

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

const aiReviewElision = "\n[... content omitted ...]\n"

// aiReviewEvidence 在请求线程内使用；入队前只保留预算内的独立字符串。
type aiReviewEvidence struct {
	views   []aiReviewMessageView
	limit   int
	omitted bool
}

// sampleAIReviewText 保留首尾，避免同一条 user 消息中的编辑器前置上下文遮住末尾任务。
func sampleAIReviewText(text string, limit int) string {
	if limit <= 0 {
		return ""
	}
	prefix, count := clipAIReviewRunes(text, limit)
	if len(prefix) == len(text) {
		return strings.Clone(prefix)
	}
	markerChars := utf8.RuneCountInString(aiReviewElision)
	if limit <= markerChars {
		return strings.Repeat("…", min(count, limit))
	}
	// 给末尾更多空间：编辑器通常把当前任务放在背景说明之后。
	headChars := (limit - markerChars) / 3
	tailChars := limit - markerChars - headChars
	head, _ := clipAIReviewRunes(text, headChars)
	start := len(text)
	for range tailChars {
		if start == 0 {
			break
		}
		_, size := utf8.DecodeLastRuneInString(text[:start])
		start -= size
	}
	return head + aiReviewElision + text[start:]
}

func (e *aiReviewEvidence) add(view aiReviewMessageView) {
	if view.Content == "" {
		return
	}
	if len(e.views) >= aiReviewMaxScanMessages*4 {
		e.omitted = true
		oldest := 0
		for i := range e.views {
			if aiReviewEvidencePriority(e.views[i]) > aiReviewEvidencePriority(e.views[oldest]) {
				oldest = i
			}
		}
		if aiReviewEvidencePriority(view) > aiReviewEvidencePriority(e.views[oldest]) {
			return
		}
		copy(e.views[oldest:], e.views[oldest+1:])
		e.views = e.views[:len(e.views)-1]
	}
	view.Role = sampleAIReviewText(view.Role, 64)
	view.Type = sampleAIReviewText(view.Type, 64)
	view.ToolName = sampleAIReviewText(view.ToolName, 128)
	view.ToolCallID = sampleAIReviewText(view.ToolCallID, 128)
	e.views = append(e.views, view)
}

// content 只抽取文本与工具载荷，不序列化图片、音频或文件的内联数据。
func (e *aiReviewEvidence) content(value any, view aiReviewMessageView, depth int) {
	if depth > 8 {
		e.omitted = true
		return
	}
	switch value := value.(type) {
	case nil:
	case string:
		view.Content = value
		e.add(view)
	case json.RawMessage:
		var decoded any
		if common.Unmarshal(value, &decoded) == nil {
			e.content(decoded, view, depth+1)
		}
	case []any:
		first := len(e.views)
		for i, block := range value {
			if i >= aiReviewMaxScanMessages/3 && i < len(value)-aiReviewMaxScanMessages*2/3 {
				e.omitted = true
				continue
			}
			e.content(block, view, depth+1)
		}
		e.mergeTextBlocks(first)
	case []dto.MediaContent:
		first := len(e.views)
		for i, block := range value {
			if i >= aiReviewMaxScanMessages/3 && i < len(value)-aiReviewMaxScanMessages*2/3 {
				e.omitted = true
				continue
			}
			e.content(block, view, depth+1)
		}
		e.mergeTextBlocks(first)
	case dto.MediaContent:
		e.content(map[string]any{"type": value.Type, "text": value.Text}, view, depth+1)
	case []dto.ClaudeMediaMessage:
		first := len(e.views)
		for i, block := range value {
			if i >= aiReviewMaxScanMessages/3 && i < len(value)-aiReviewMaxScanMessages*2/3 {
				e.omitted = true
				continue
			}
			e.content(block, view, depth+1)
		}
		e.mergeTextBlocks(first)
	case dto.ClaudeMediaMessage:
		var text string
		if value.Text != nil {
			text = *value.Text
		}
		e.content(map[string]any{
			"type": value.Type, "text": text, "id": value.Id,
			"name": value.Name, "input": value.Input,
			"content": value.Content, "tool_use_id": value.ToolUseId,
		}, view, depth+1)
	case map[string]any:
		kind, _ := value["type"].(string)
		if view.Type != "tool_result" && view.Type != "function_call_output" && view.Type != "custom_tool_call_output" {
			view.Type = kind
		}
		switch kind {
		case "text", "input_text", "output_text", "":
			if text, ok := value["text"].(string); ok {
				view.Content = text
				e.add(view)
			} else if kind == "" && (view.Role == "tool" || view.Type == "tool_result") {
				view.Content = aiReviewToolText(value)
				e.add(view)
			}
		case "tool_result":
			view.ToolCallID, _ = value["tool_use_id"].(string)
			e.content(value["content"], view, depth+1)
		case "tool_use":
			view.ToolName, _ = value["name"].(string)
			view.ToolCallID, _ = value["id"].(string)
			view.Content = aiReviewToolText(value["input"])
			e.add(view)
		default:
			view.Content = "[non-text content omitted]"
			e.add(view)
		}
	}
}

// mergeTextBlocks 将同一来源的连续文本视为一条证据，首尾采样覆盖整条消息而非最后一块。
func (e *aiReviewEvidence) mergeTextBlocks(first int) {
	first = min(first, len(e.views))
	write := first
	for i := first; i < len(e.views); {
		left := e.views[i]
		textBlock := left.Type == "" || left.Type == "text" || left.Type == "input_text" || left.Type == "output_text" || left.Type == "tool_result" || left.Type == "function_call_output" || left.Type == "custom_tool_call_output"
		end := i + 1
		if textBlock {
			for end < len(e.views) {
				right := e.views[end]
				if left.Role != right.Role || left.Type != right.Type || left.ToolName != right.ToolName || left.ToolCallID != right.ToolCallID {
					break
				}
				end++
			}
		}
		if end > i+1 {
			var text strings.Builder
			text.WriteString(left.Content)
			for j := i + 1; j < end; j++ {
				text.WriteByte('\n')
				text.WriteString(e.views[j].Content)
			}
			left.Content = text.String()
		}
		e.views[write] = left
		write++
		i = end
	}
	clear(e.views[write:])
	e.views = e.views[:write]
}

func aiReviewToolText(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	if value == nil {
		return ""
	}
	data, err := common.Marshal(value)
	if err != nil {
		return ""
	}
	return string(data)
}

func aiReviewEvidencePriority(view aiReviewMessageView) int {
	if view.ToolCallID != "" || view.Role == "tool" || view.Type == "tool_use" || view.Type == "tool_result" || strings.Contains(view.Type, "function_call") || strings.Contains(view.Type, "custom_tool_call") {
		return 1
	}
	if view.Role == "user" {
		return 0
	}
	return 2
}

// excerpt 为用户、工具和背景隔离预算，未用完的份额再按优先级分配。
// 最后恢复请求顺序，避免审核模型把倒序历史当成当前对话。
func (e *aiReviewEvidence) excerpt() (string, bool) {
	if len(e.views) == 0 || e.limit <= 0 {
		return "", false
	}
	toolNames := make(map[string]string)
	for i, view := range e.views {
		if view.ToolCallID == "" {
			continue
		}
		if view.ToolName != "" {
			toolNames[view.ToolCallID] = view.ToolName
		} else {
			e.views[i].ToolName = toolNames[view.ToolCallID]
		}
	}
	const omissionNotice = "[Partial evidence: older messages, blocks or text may be omitted.]"
	remaining := max(0, e.limit-utf8.RuneCountInString(omissionNotice))
	selected := make(map[int]string)
	for priority, share := range []int{60, 25, 15} {
		budget := remaining * share / 100
		for i := len(e.views) - 1; i >= 0 && budget > 0; i-- {
			if aiReviewEvidencePriority(e.views[i]) != priority {
				continue
			}
			// 单条长消息不能吞掉同类的全部证据。
			allowance := min(budget, max(256, budget*2/3))
			text := sampleAIReviewText(e.views[i].Content, allowance)
			selected[i] = text
			budget -= utf8.RuneCountInString(text)
		}
	}
	used := 0
	for _, text := range selected {
		used += utf8.RuneCountInString(text)
	}
	for priority := range 2 {
		for i := len(e.views) - 1; i >= 0 && used < remaining; i-- {
			if aiReviewEvidencePriority(e.views[i]) != priority {
				continue
			}
			previous := utf8.RuneCountInString(selected[i])
			text := sampleAIReviewText(e.views[i].Content, previous+remaining-used)
			selected[i] = text
			used += utf8.RuneCountInString(text) - previous
		}
	}
	views := make([]aiReviewMessageView, 0, len(selected)+1)
	for i, view := range e.views {
		text, ok := selected[i]
		if !ok || text == "" {
			e.omitted = true
			continue
		}
		e.omitted = e.omitted || text != view.Content
		view.Content = text
		views = append(views, view)
	}
	if e.omitted {
		views = append(views, aiReviewMessageView{Role: "context", Type: "omission_notice", Content: sampleAIReviewText(omissionNotice, e.limit-used)})
	}
	data, err := common.Marshal(views)
	return string(data), err == nil
}

// buildAIReviewExcerptJSON 不修改协议 DTO；仅为审核保留最近消息及其工具来源。
func buildAIReviewExcerptJSON(request dto.Request, maxChars int) (string, bool) {
	evidence := &aiReviewEvidence{limit: maxChars}
	switch req := request.(type) {
	case *dto.GeneralOpenAIRequest:
		start := max(0, len(req.Messages)-aiReviewMaxScanMessages)
		evidence.omitted = start > 0
		latestUser := -1
		for i := len(req.Messages) - 1; i >= 0; i-- {
			if req.Messages[i].Role == "user" {
				latestUser = i
				break
			}
		}
		indices := make([]int, 0, aiReviewMaxScanMessages+1)
		if latestUser >= 0 && latestUser < start {
			indices = append(indices, latestUser)
		}
		for i := start; i < len(req.Messages); i++ {
			indices = append(indices, i)
		}
		for _, i := range indices {
			message := req.Messages[i]
			view := aiReviewMessageView{Role: message.Role, ToolCallID: message.ToolCallId}
			if message.Name != nil {
				view.ToolName = *message.Name
			}
			evidence.content(message.Content, view, 0)
			calls := message.ParseToolCalls()
			callStart := max(0, len(calls)-aiReviewMaxScanMessages)
			evidence.omitted = evidence.omitted || callStart > 0
			for _, call := range calls[callStart:] {
				name, text, kind := call.Function.Name, call.Function.Arguments, "function_call"
				if call.Type == dto.CustomType {
					var custom struct {
						Name  string `json:"name"`
						Input string `json:"input"`
					}
					if common.Unmarshal(call.Custom, &custom) == nil {
						name, text, kind = custom.Name, custom.Input, "custom_tool_call"
					}
				}
				evidence.add(aiReviewMessageView{Role: message.Role, Type: kind, ToolName: name, ToolCallID: call.ID, Content: text})
			}
		}
	case *dto.ClaudeRequest:
		evidence.content(req.System, aiReviewMessageView{Role: "system"}, 0)
		start := max(0, len(req.Messages)-aiReviewMaxScanMessages)
		evidence.omitted = evidence.omitted || start > 0
		latestUser := -1
		for i := len(req.Messages) - 1; i >= 0; i-- {
			message := req.Messages[i]
			if message.Role != "user" {
				continue
			}
			content := message.Content
			if raw, ok := content.(json.RawMessage); ok {
				_ = common.Unmarshal(raw, &content)
			}
			hasUserContent := false
			switch value := content.(type) {
			case string:
				hasUserContent = value != ""
			case []any:
				for _, block := range value {
					if block, ok := block.(map[string]any); ok && block["type"] != "tool_result" {
						hasUserContent = true
						break
					}
				}
			case []dto.ClaudeMediaMessage:
				for _, block := range value {
					if block.Type != "tool_result" {
						hasUserContent = true
						break
					}
				}
			}
			if hasUserContent {
				latestUser = i
				break
			}
		}
		if latestUser >= 0 && latestUser < start {
			message := req.Messages[latestUser]
			evidence.content(message.Content, aiReviewMessageView{Role: message.Role}, 0)
		}
		for _, message := range req.Messages[start:] {
			evidence.content(message.Content, aiReviewMessageView{Role: message.Role}, 0)
		}
	case *dto.OpenAIResponsesRequest:
		evidence.add(aiReviewMessageView{Role: "system", Content: responsesInstructionsText(req)})
		if common.GetJsonType(req.Input) == "string" {
			evidence.content(req.Input, aiReviewMessageView{Role: "user"}, 0)
			break
		}
		var input []struct {
			Type      string          `json:"type"`
			Role      string          `json:"role"`
			Name      string          `json:"name"`
			CallID    string          `json:"call_id"`
			Content   json.RawMessage `json:"content"`
			Arguments json.RawMessage `json:"arguments"`
			Input     json.RawMessage `json:"input"`
			Output    json.RawMessage `json:"output"`
		}
		if common.Unmarshal(req.Input, &input) != nil {
			return "", false
		}
		start := max(0, len(input)-aiReviewMaxScanMessages)
		evidence.omitted = start > 0
		latestUser := -1
		for i := len(input) - 1; i >= 0; i-- {
			item := input[i]
			if (item.Type == "message" || item.Type == "") && (item.Role == "user" || item.Role == "") {
				latestUser = i
				break
			}
		}
		indices := make([]int, 0, aiReviewMaxScanMessages+1)
		if latestUser >= 0 && latestUser < start {
			indices = append(indices, latestUser)
		}
		for i := start; i < len(input); i++ {
			indices = append(indices, i)
		}
		for _, i := range indices {
			item := input[i]
			view := aiReviewMessageView{Role: item.Role, Type: item.Type, ToolName: item.Name, ToolCallID: item.CallID}
			switch item.Type {
			case "function_call", "custom_tool_call":
				view.Role = "assistant"
				payload := item.Arguments
				if item.Type == "custom_tool_call" {
					payload = item.Input
				}
				var value any
				if common.Unmarshal(payload, &value) == nil {
					view.Content = aiReviewToolText(value)
					evidence.add(view)
				}
			case "function_call_output", "custom_tool_call_output":
				view.Role = "tool"
				evidence.content(item.Output, view, 0)
			case "message", "":
				if view.Role == "" {
					view.Role = "user"
				}
				evidence.content(item.Content, view, 0)
			}
		}
	default:
		return "", false
	}
	return evidence.excerpt()
}

func buildSensitiveAIReviewExcerpt(request dto.Request, excerpt, matchedWordsJSON string, maxChars int) string {
	var words []string
	_ = common.UnmarshalJsonStr(matchedWordsJSON, &words)
	views := make([]aiReviewMessageView, 0)
	budget := maxChars / 3
	// 单独分配命中窗口，不能对已留证的内容再取前缀而把命中证据丢掉。
	for i, word := range words {
		if word == "" || budget <= 0 {
			continue
		}
		spans := sensitiveWordByteSpans(excerpt, []string{word})
		if len(spans) == 0 {
			continue
		}
		span := spans[0]
		start := alignRuneBoundary(excerpt, max(0, span[0]-96))
		end := alignRuneBoundary(excerpt, min(len(excerpt), span[1]+96))
		allowance := max(1, budget/(len(words)-i))
		text := excerpt[start:end]
		if utf8.RuneCountInString(text) > allowance {
			// 窗口放不下时先保留命中词，不能把词放在首尾采样的省略区。
			text, _ = clipAIReviewRunes(excerpt[span[0]:span[1]], allowance)
		}
		text = strings.Clone(text)
		views = append(views, aiReviewMessageView{Role: "context", Type: "sensitive_match", Content: text})
		budget -= utf8.RuneCountInString(text)
	}
	used := 0
	for _, view := range views {
		used += utf8.RuneCountInString(view.Content)
	}
	if structured, ok := buildAIReviewExcerptJSON(request, maxChars-used); ok {
		var requestViews []aiReviewMessageView
		if common.UnmarshalJsonStr(structured, &requestViews) == nil {
			views = append(views, requestViews...)
		}
	} else {
		views = append(views, aiReviewMessageView{Role: "context", Content: sampleAIReviewText(excerpt, maxChars-used)})
	}
	data, err := common.Marshal(views)
	if err != nil {
		return ""
	}
	return string(data)
}
