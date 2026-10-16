package common

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// ParseProxyURLStrict validates and normalizes a proxy URL for persistence.
func ParseProxyURLStrict(rawProxyURL string) (*url.URL, error) {
	parsedURL, _, err := parseProxyURL(rawProxyURL, false)
	return parsedURL, err
}

// ParseProxyURLRuntime validates and normalizes a proxy URL for runtime use.
// The boolean result reports whether a legacy path, query, or fragment was removed.
func ParseProxyURLRuntime(rawProxyURL string) (*url.URL, bool, error) {
	return parseProxyURL(rawProxyURL, true)
}

// CanonicalProxyURL returns the canonical persisted form of a proxy URL: the
// proxy pool stores and de-duplicates this exact string. It differs from
// service.NormalizeProxyURL, which produces the runtime client cache key and
// tolerates legacy path/query suffixes. The credentials are preserved because
// the URL itself is the outbound credential; never write the result to logs,
// audit records, or API responses.
func CanonicalProxyURL(rawProxyURL string) (string, error) {
	parsedURL, err := ParseProxyURLStrict(rawProxyURL)
	if err != nil {
		return "", err
	}
	if parsedURL == nil {
		return "", fmt.Errorf("proxy URL is required")
	}
	return parsedURL.String(), nil
}

// ProxyURLHash returns the hex SHA-256 of a normalized proxy URL. It is the
// portable uniqueness key for proxy pool entries and import de-duplication.
func ProxyURLHash(normalizedProxyURL string) string {
	sum := sha256.Sum256([]byte(normalizedProxyURL))
	return hex.EncodeToString(sum[:])
}

// MaskProxyURLCredentials hides the password of a proxy URL while keeping the
// scheme, user name, host, and port readable, so proxy addresses can be shown in
// the admin console and written to logs without leaking credentials. The mask is
// spliced into the original text rather than rebuilt through url.URL.String(),
// which would percent-encode the mask and any escaped user name.
func MaskProxyURLCredentials(rawProxyURL string) string {
	trimmed := strings.TrimSpace(rawProxyURL)
	if trimmed == "" {
		return ""
	}
	prefix := ""
	authority := trimmed
	if schemeEnd := strings.Index(trimmed, "://"); schemeEnd >= 0 {
		prefix = trimmed[:schemeEnd+3]
		authority = trimmed[schemeEnd+3:]
	}
	// The credentials, if any, are inside the authority component, which ends at
	// the first path, query, or fragment delimiter.
	if authorityEnd := strings.IndexAny(authority, "/?#"); authorityEnd >= 0 {
		authority = authority[:authorityEnd]
	}
	atIndex := strings.Index(authority, "@")
	if atIndex < 0 {
		return trimmed
	}
	userinfo := authority[:atIndex]
	passwordIndex := strings.Index(userinfo, ":")
	if passwordIndex < 0 {
		// A bare user name carries no secret to hide.
		return trimmed
	}
	if passwordIndex == 0 {
		return prefix + "***" + trimmed[len(prefix)+atIndex:]
	}
	return prefix + userinfo[:passwordIndex] + ":***" + trimmed[len(prefix)+atIndex:]
}

func parseProxyURL(rawProxyURL string, allowLegacySuffix bool) (*url.URL, bool, error) {
	trimmedProxyURL := strings.TrimSpace(rawProxyURL)
	if trimmedProxyURL == "" {
		return nil, false, nil
	}

	parsedURL, err := url.Parse(trimmedProxyURL)
	if err != nil {
		return nil, false, fmt.Errorf("invalid proxy URL")
	}
	parsedURL.Scheme = strings.ToLower(parsedURL.Scheme)
	switch parsedURL.Scheme {
	case "http", "https", "socks5", "socks5h":
	default:
		return nil, false, fmt.Errorf("proxy URL must use http, https, socks5, or socks5h")
	}
	if parsedURL.Hostname() == "" {
		return nil, false, fmt.Errorf("proxy URL must include a host")
	}
	if portText := parsedURL.Port(); portText != "" {
		port, err := strconv.Atoi(portText)
		if err != nil || port < 1 || port > 65535 {
			return nil, false, fmt.Errorf("proxy URL must include a valid port")
		}
	}

	hasQuery := parsedURL.RawQuery != "" || parsedURL.ForceQuery
	hasFragment := strings.Contains(trimmedProxyURL, "#")
	escapedPath := parsedURL.EscapedPath()
	hasNonRootPath := escapedPath != "" && escapedPath != "/"
	legacySuffixStripped := hasQuery || hasFragment || hasNonRootPath
	if !allowLegacySuffix {
		switch {
		case hasQuery:
			return nil, false, fmt.Errorf("proxy URL must not include a query")
		case hasFragment:
			return nil, false, fmt.Errorf("proxy URL must not include a fragment")
		case hasNonRootPath:
			return nil, false, fmt.Errorf("proxy URL must not include a path")
		}
	}

	parsedURL.Path = ""
	parsedURL.RawPath = ""
	parsedURL.RawQuery = ""
	parsedURL.ForceQuery = false
	parsedURL.Fragment = ""
	parsedURL.RawFragment = ""

	if (parsedURL.Scheme == "socks5" || parsedURL.Scheme == "socks5h") && parsedURL.Port() == "" {
		parsedURL.Host = net.JoinHostPort(parsedURL.Hostname(), "1080")
	}

	return parsedURL, legacySuffixStripped, nil
}
