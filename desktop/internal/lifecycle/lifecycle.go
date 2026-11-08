// Package lifecycle builds the fixed status.log tokens for one build.
package lifecycle

import (
	"fmt"
	"strings"
)

// Startup is the one-line record written when the process starts.
// build is an ASCII marker such as AIQUIZFORMS_BUILD=v3d.
// The words registered and failed are the only registration results.
func Startup(build string, exitOK, answerOK, toggleOK bool) (string, error) {
	if build == "" || strings.ContainsAny(build, " \t\r\n") {
		return "", fmt.Errorf("invalid build marker")
	}
	return fmt.Sprintf("startup %s exit=%s answer=%s toggle=%s",
		build, flag(exitOK), flag(answerOK), flag(toggleOK)), nil
}

// ForceExitEvent is written only as a best effort when the top-row 1 key stops the process.
func ForceExitEvent() string {
	return "hotkey-exit-force"
}

func flag(ok bool) string {
	if ok {
		return "registered"
	}
	return "failed"
}
