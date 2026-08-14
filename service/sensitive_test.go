package service

import (
	"testing"

	"github.com/QuantumNous/new-api/setting"
	"github.com/stretchr/testify/assert"
)

func TestSensitiveWordContains(t *testing.T) {
	original := setting.SensitiveWords
	setting.SensitiveWords = []string{"hi", "hello", "违禁词"}
	t.Cleanup(func() { setting.SensitiveWords = original })

	tests := []struct {
		name string
		text string
		want bool
	}{
		// 纯英文敏感词按整词匹配
		{"独立 hi", "say hi", true},
		{"hi 加标点", "hi!", true},
		{"纯 hi 消息", "hi", true},
		{"大小写不敏感", "Hi there", true},
		{"hi 藏于常见单词", "this which machine ship think", false},
		{"hello 独立", "hello there", true},
		{"hello 后接单词", "helloworld", false},
		// 非纯英文敏感词仍按子串匹配
		{"中文敏感词子串", "这是违禁词内容", true},
		{"中文词夹在英文中", "test违禁词end", true},
		// 无敏感词
		{"无敏感词", "how are you", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ok, words := SensitiveWordContains(tt.text)
			assert.Equal(t, tt.want, ok)
			if ok {
				assert.NotEmpty(t, words)
			}
		})
	}
}
