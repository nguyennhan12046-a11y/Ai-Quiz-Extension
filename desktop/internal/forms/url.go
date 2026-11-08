package forms

import (
	"net/url"
	"strings"
)

func IsGoogleForm(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u == nil {
		return false
	}
	if !strings.EqualFold(u.Scheme, "https") {
		return false
	}
	if !strings.EqualFold(u.Hostname(), "docs.google.com") {
		return false
	}
	path := strings.ToLower(u.Path)
	if !strings.HasPrefix(path, "/forms/") && path != "/forms" {
		return false
	}
	if strings.Contains(path, "formresponse") {
		return false
	}
	return true
}

func IsAllowedNavigation(raw string) bool {
	return IsGoogleForm(raw)
}
