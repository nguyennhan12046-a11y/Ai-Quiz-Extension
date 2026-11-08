package groq

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"aiquizforms/internal/config"
	"aiquizforms/internal/fill"
)

func TestAnswerUsesGroqCompatibleEndpointAndHidesKey(t *testing.T) {
	const secret = "gsk_super_secret"
	var gotPath, gotAuth, gotModel string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		body, _ := io.ReadAll(r.Body)
		if strings.Contains(string(body), "gpt-oss-120b") {
			gotModel = "openai/gpt-oss-120b"
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"[{\"id\":\"q_0\",\"answer\":\"B\"}]"}}]}`)
	}))
	defer srv.Close()

	answers, err := (&Client{HTTP: srv.Client()}).Answer(context.Background(), config.File{
		APIKey:  secret,
		BaseURL: srv.URL,
		Model:   config.DefaultModel,
	}, []fill.Question{{ID: "q_0", Type: "multiple_choice", Text: "2+2?", Options: []string{"3", "4"}}})
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/v1/chat/completions" {
		t.Fatalf("path = %s", gotPath)
	}
	if gotAuth != "Bearer "+secret {
		t.Fatal("auth header missing")
	}
	if gotModel != config.DefaultModel {
		t.Fatalf("model = %s", gotModel)
	}
	if len(answers) != 1 || answers[0].Answer != "B" {
		t.Fatalf("answers = %+v", answers)
	}
}

func TestMissingKeyDoesNotCallNetwork(t *testing.T) {
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))
	defer srv.Close()
	_, err := (&Client{HTTP: srv.Client()}).Answer(context.Background(), config.File{BaseURL: srv.URL, Model: config.DefaultModel}, nil)
	if err == nil || called {
		t.Fatalf("err=%v called=%v", err, called)
	}
	if strings.Contains(err.Error(), "gsk_") {
		t.Fatal(err)
	}
}

func TestHTTPErrorRedactsKey(t *testing.T) {
	const secret = "gsk_super_secret"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, "bad key "+secret)
	}))
	defer srv.Close()
	_, err := (&Client{HTTP: srv.Client()}).Answer(context.Background(), config.File{
		APIKey: secret, BaseURL: srv.URL, Model: config.DefaultModel,
	}, []fill.Question{{ID: "q_0", Type: "text", Text: "Hi"}})
	if err == nil {
		t.Fatal("expected error")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("error leaked key: %v", err)
	}
}
