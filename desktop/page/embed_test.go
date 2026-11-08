package page

import (
	"strings"
	"testing"
)

func TestScriptExportsDesktopAPIAndDoesNotSubmit(t *testing.T) {
	src := Script()
	if !strings.Contains(src, "__AIA_DESKTOP_API__") {
		t.Fatal("desktop API missing")
	}
	if strings.Contains(src, "chrome.runtime") || strings.Contains(src, ".submit(") {
		t.Fatal("script still depends on the extension or submits the form")
	}
	if strings.Contains(src, "aia-highlight") || strings.Contains(src, "aia-question-badge") {
		t.Fatal("script still draws on-page chrome")
	}
}
