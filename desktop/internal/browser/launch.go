package browser

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
)

type Launch struct {
	Exe     string
	Profile string
	Port    int
	OpenURL string
}

func LaunchArgs(profile string, port int, openURL string) []string {
	args := []string{
		"--user-data-dir=" + profile,
		"--remote-debugging-address=127.0.0.1",
		fmt.Sprintf("--remote-debugging-port=%d", port),
		"--remote-allow-origins=*",
		"--no-first-run",
		"--no-default-browser-check",
		"--new-window",
	}
	if openURL != "" {
		args = append(args, openURL)
	}
	return args
}

func FreePort() (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port, nil
}

func DefaultCandidates() []string {
	pf := os.Getenv("ProgramFiles")
	pf86 := os.Getenv("ProgramFiles(x86)")
	local := os.Getenv("LOCALAPPDATA")
	return []string{
		filepath.Join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(local, "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(pf, "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
	}
}

func FindBrowser(candidates []string, exists func(string) bool) (string, error) {
	for _, path := range candidates {
		if path == "" || path == "." || path == string(filepath.Separator) {
			continue
		}
		if exists(path) {
			return path, nil
		}
	}
	return "", fmt.Errorf("khong tim thay Microsoft Edge hoac Google Chrome")
}

func ForbiddenLaunchFlag(arg string) bool {
	lower := arg
	for _, bad := range []string{
		"headless",
		"disable-blink-features",
		"AutomationControlled",
		"disable-extensions",
		"excludeSwitches",
	} {
		if containsFold(lower, bad) {
			return true
		}
	}
	return false
}

func containsFold(s, part string) bool {
	return len(s) >= len(part) && indexFold(s, part) >= 0
}

func indexFold(s, part string) int {
	s = stringsToLower(s)
	part = stringsToLower(part)
	for i := 0; i+len(part) <= len(s); i++ {
		if s[i:i+len(part)] == part {
			return i
		}
	}
	return -1
}

func stringsToLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

func PortFromArgs(args []string) int {
	const prefix = "--remote-debugging-port="
	for _, arg := range args {
		if len(arg) > len(prefix) && arg[:len(prefix)] == prefix {
			n, err := strconv.Atoi(arg[len(prefix):])
			if err == nil {
				return n
			}
		}
	}
	return 0
}
