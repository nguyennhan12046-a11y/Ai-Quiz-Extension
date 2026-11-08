package diag

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Append writes a short local status line. Callers must pass a fixed event name,
// not form text, model output, or an API key. key is redacted if it appears.
func Append(dir, event, key string) error {
	event = strings.TrimSpace(event)
	if event == "" || strings.ContainsAny(event, "\r\n") {
		return fmt.Errorf("invalid diagnostic event")
	}
	if key != "" {
		event = strings.ReplaceAll(event, key, "[khoa-da-an]")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(dir, "status.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	line := time.Now().UTC().Format(time.RFC3339) + " " + event + "\n"
	_, err = f.WriteString(line)
	return err
}
