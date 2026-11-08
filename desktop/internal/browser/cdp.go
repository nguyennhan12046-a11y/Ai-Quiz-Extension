package browser

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"

	"aiquizforms/internal/forms"
)

type Target struct {
	ID                   string `json:"id"`
	Type                 string `json:"type"`
	URL                  string `json:"url"`
	Title                string `json:"title"`
	WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
}

func ListTargets(ctx context.Context, port int) ([]Target, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/json/list", port), nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("trinh duyet tra loi %d: %s", resp.StatusCode, string(body))
	}
	var targets []Target
	if err := json.NewDecoder(resp.Body).Decode(&targets); err != nil {
		return nil, err
	}
	return targets, nil
}

func PickFormTarget(targets []Target) *Target {
	var home *Target
	for i := range targets {
		t := &targets[i]
		if t.Type != "page" || t.WebSocketDebuggerURL == "" {
			continue
		}
		if !forms.IsGoogleForm(t.URL) {
			continue
		}
		if strings.Contains(strings.ToLower(t.URL), "/forms/d/") {
			return t
		}
		if home == nil {
			home = t
		}
	}
	return home
}

type callResult struct {
	Result struct {
		Result struct {
			Value json.RawMessage `json:"value"`
		} `json:"result"`
		ExceptionDetails *struct {
			Text string `json:"text"`
		} `json:"exceptionDetails"`
	} `json:"result"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func Evaluate(ctx context.Context, wsURL, expression string) (json.RawMessage, error) {
	raw, err := call(ctx, wsURL, "Runtime.evaluate", map[string]any{
		"expression":    expression,
		"returnByValue": true,
		"awaitPromise":  false,
	})
	if err != nil {
		return nil, err
	}
	var parsed callResult
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, err
	}
	if parsed.Error != nil {
		return nil, fmt.Errorf("%s", parsed.Error.Message)
	}
	if parsed.Result.ExceptionDetails != nil {
		return nil, fmt.Errorf("%s", parsed.Result.ExceptionDetails.Text)
	}
	if len(parsed.Result.Result.Value) == 0 {
		return json.RawMessage("null"), nil
	}
	return parsed.Result.Result.Value, nil
}

func Navigate(ctx context.Context, wsURL, dest string) error {
	if !forms.IsAllowedNavigation(dest) {
		return fmt.Errorf("tu choi mo trang khong phai Google Form")
	}
	_, err := call(ctx, wsURL, "Page.navigate", map[string]any{"url": dest})
	return err
}

func call(ctx context.Context, wsURL, method string, params any) (json.RawMessage, error) {
	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		return nil, err
	}
	defer conn.Close(websocket.StatusNormalClosure, "")
	payload, err := json.Marshal(map[string]any{
		"id":     1,
		"method": method,
		"params": params,
	})
	if err != nil {
		return nil, err
	}
	writeCtx, cancelWrite := context.WithTimeout(ctx, 15*time.Second)
	err = conn.Write(writeCtx, websocket.MessageText, payload)
	cancelWrite()
	if err != nil {
		return nil, err
	}
	deadline, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	for {
		_, data, err := conn.Read(deadline)
		if err != nil {
			return nil, err
		}
		var head struct {
			ID int `json:"id"`
		}
		if json.Unmarshal(data, &head) != nil || head.ID != 1 {
			continue
		}
		return data, nil
	}
}

func WaitReady(ctx context.Context, port int) error {
	var last error
	for {
		if err := ctx.Err(); err != nil {
			if last != nil {
				return last
			}
			return err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/json/version", port), nil)
		if err == nil {
			resp, err := http.DefaultClient.Do(req)
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					return nil
				}
				last = fmt.Errorf("status %d", resp.StatusCode)
			} else {
				last = err
			}
		} else {
			last = err
		}
		timer := time.NewTimer(200 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

func DebugBody(prefix string, body []byte) string {
	body = bytes.TrimSpace(body)
	if len(body) > 180 {
		body = body[:180]
	}
	return prefix + string(body)
}
