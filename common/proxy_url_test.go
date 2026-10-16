package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCanonicalProxyURL(t *testing.T) {
	tests := []struct {
		name      string
		raw       string
		expected  string
		expectErr bool
	}{
		{name: "http with credentials", raw: "  HTTP://user:pass@127.0.0.1:8080  ", expected: "http://user:pass@127.0.0.1:8080"},
		{name: "socks5 default port", raw: "socks5://user:pass@host", expected: "socks5://user:pass@host:1080"},
		{name: "socks5h keeps scheme", raw: "socks5h://host:1080", expected: "socks5h://host:1080"},
		{name: "trailing root path removed", raw: "https://host:443/", expected: "https://host:443"},
		{name: "empty rejected", raw: "   ", expectErr: true},
		{name: "unsupported scheme rejected", raw: "ftp://host:21", expectErr: true},
		{name: "query rejected", raw: "http://host:8080/?x=1", expectErr: true},
		{name: "path rejected", raw: "http://host:8080/proxy.pac", expectErr: true},
		{name: "missing host rejected", raw: "http://:8080", expectErr: true},
		{name: "invalid port rejected", raw: "http://host:99999", expectErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			normalized, err := CanonicalProxyURL(tt.raw)
			if tt.expectErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.expected, normalized)
		})
	}
}

func TestProxyURLHashTracksCredentialsAndHost(t *testing.T) {
	first, err := CanonicalProxyURL("socks5://user:pass@host:1080")
	require.NoError(t, err)
	second, err := CanonicalProxyURL("socks5://user:pass@host:1080")
	require.NoError(t, err)
	otherPassword, err := CanonicalProxyURL("socks5://user:other@host:1080")
	require.NoError(t, err)
	otherHost, err := CanonicalProxyURL("socks5://user:pass@host2:1080")
	require.NoError(t, err)

	assert.Equal(t, ProxyURLHash(first), ProxyURLHash(second))
	assert.NotEqual(t, ProxyURLHash(first), ProxyURLHash(otherPassword))
	assert.NotEqual(t, ProxyURLHash(first), ProxyURLHash(otherHost))
}

func TestMaskProxyURLCredentials(t *testing.T) {
	tests := []struct {
		name     string
		raw      string
		expected string
	}{
		{name: "password hidden", raw: "socks5://user:secret@host:1080", expected: "socks5://user:***@host:1080"},
		{name: "escaped password hidden", raw: "http://user:p%40ss@host:8080", expected: "http://user:***@host:8080"},
		{name: "password only", raw: "http://:secret@host:8080", expected: "http://***@host:8080"},
		{name: "user name only kept", raw: "http://user@host:8080", expected: "http://user@host:8080"},
		{name: "no credentials unchanged", raw: "http://host:8080", expected: "http://host:8080"},
		{name: "empty stays empty", raw: "   ", expected: ""},
		{name: "unparsable input stripped", raw: "http://:bad pass@host:8080", expected: "http://***@host:8080"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, MaskProxyURLCredentials(tt.raw))
		})
	}
}
