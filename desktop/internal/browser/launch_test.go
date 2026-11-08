package browser

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLaunchArgsAreVisibleAndLocal(t *testing.T) {
	args := LaunchArgs(`C:\Users\Me\AppData\Roaming\AIQuizForms\browser-profile`, 9333, "https://docs.google.com/forms/")
	joined := strings.Join(args, "\n")
	if !strings.Contains(joined, "--user-data-dir=") || !strings.Contains(joined, "--remote-debugging-address=127.0.0.1") {
		t.Fatalf("args = %v", args)
	}
	if !strings.Contains(joined, "--remote-debugging-port=9333") {
		t.Fatalf("port missing: %v", args)
	}
	if !strings.Contains(joined, "https://docs.google.com/forms/") {
		t.Fatal("forms home missing")
	}
	for _, arg := range args {
		if ForbiddenLaunchFlag(arg) {
			t.Fatalf("forbidden flag %s", arg)
		}
	}
	if PortFromArgs(args) != 9333 {
		t.Fatal(PortFromArgs(args))
	}
}

func TestFindBrowserPrefersEdge(t *testing.T) {
	dir := t.TempDir()
	edge := filepath.Join(dir, "msedge.exe")
	chrome := filepath.Join(dir, "chrome.exe")
	if err := os.WriteFile(edge, []byte("edge"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(chrome, []byte("chrome"), 0o755); err != nil {
		t.Fatal(err)
	}
	got, err := FindBrowser([]string{edge, chrome}, func(path string) bool {
		_, err := os.Stat(path)
		return err == nil
	})
	if err != nil || got != edge {
		t.Fatalf("got %s err %v", got, err)
	}
	if _, err := FindBrowser([]string{filepath.Join(dir, "missing.exe")}, func(string) bool { return false }); err == nil {
		t.Fatal("expected missing browser error")
	}
}
