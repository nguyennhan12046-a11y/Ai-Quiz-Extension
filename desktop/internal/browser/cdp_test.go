package browser

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/coder/websocket"
)

func TestPickFormTargetSkipsOtherSitesAndSubmitURL(t *testing.T) {
	targets := []Target{
		{ID: "1", Type: "page", URL: "https://example.com/forms/d/e/abc/viewform", WebSocketDebuggerURL: "ws://bad"},
		{ID: "2", Type: "page", URL: "https://docs.google.com/forms/d/e/abc/formResponse", WebSocketDebuggerURL: "ws://submit"},
		{ID: "3", Type: "page", URL: "https://docs.google.com/forms/", WebSocketDebuggerURL: "ws://home"},
		{ID: "4", Type: "page", URL: "https://docs.google.com/forms/d/e/abc/viewform", WebSocketDebuggerURL: "ws://form"},
	}
	got := PickFormTarget(targets)
	if got == nil || got.ID != "4" {
		t.Fatalf("picked %+v", got)
	}
}

func TestEvaluateAndNavigateGuard(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/json/list", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"id":"p","type":"page","url":"https://docs.google.com/forms/d/e/abc/viewform","webSocketDebuggerUrl":"PLACE"}]`))
	})
	mux.HandleFunc("/devtools/page", func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		defer conn.CloseNow()
		ctx := r.Context()
		for {
			_, data, err := conn.Read(ctx)
			if err != nil {
				return
			}
			var req struct {
				ID     int        `json:"id"`
				Method string     `json:"method"`
				Params jsonParams `json:"params"`
			}
			if err := jsonUnmarshal(data, &req); err != nil {
				return
			}
			switch req.Method {
			case "Runtime.evaluate":
				if strings.Contains(req.Params.Expression, ".submit(") {
					t.Errorf("page call tried to submit: %s", req.Params.Expression)
				}
				_ = conn.Write(ctx, websocket.MessageText, []byte(`{"id":1,"result":{"result":{"type":"object","value":{"count":1}}}}`))
			case "Page.navigate":
				if strings.Contains(req.Params.URL, "formResponse") {
					t.Errorf("navigate tried to submit")
				}
				_ = conn.Write(ctx, websocket.MessageText, []byte(`{"id":1,"result":{}}`))
			default:
				_ = conn.Write(ctx, websocket.MessageText, []byte(`{"id":1,"result":{}}`))
			}
		}
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	value, err := Evaluate(context.Background(), "ws"+strings.TrimPrefix(srv.URL, "http")+"/devtools/page", `__AIA_DESKTOP_API__.detect()`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(value), `"count":1`) {
		t.Fatalf("value = %s", value)
	}
	if err := Navigate(context.Background(), "ws"+strings.TrimPrefix(srv.URL, "http")+"/devtools/page", "https://docs.google.com/forms/d/e/abc/formResponse"); err == nil {
		t.Fatal("formResponse navigation should be rejected before CDP")
	}
}

type jsonParams struct {
	Expression string `json:"expression"`
	URL        string `json:"url"`
}

func jsonUnmarshal(data []byte, dest any) error {
	return jsonNewDecoder(data).Decode(dest)
}
