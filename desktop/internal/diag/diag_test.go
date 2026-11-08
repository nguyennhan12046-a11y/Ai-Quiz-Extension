package diag

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLogRedactsKeyAndRejectsFormText(t *testing.T) {
	dir := t.TempDir()
	const secret = "gsk_test_secret_value"
	if err := Append(dir, "close-hide", secret); err != nil {
		t.Fatal(err)
	}
	if err := Append(dir, "hotkey-answer key="+secret, secret); err != nil {
		t.Fatal(err)
	}
	if err := Append(dir, "bad\nevent", secret); err == nil {
		t.Fatal("multiline event should be rejected")
	}
	raw, err := os.ReadFile(filepath.Join(dir, "status.log"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if strings.Contains(text, secret) {
		t.Fatalf("log leaked key: %s", text)
	}
	if !strings.Contains(text, "close-hide") || !strings.Contains(text, "[khoa-da-an]") {
		t.Fatalf("log = %s", text)
	}
}
