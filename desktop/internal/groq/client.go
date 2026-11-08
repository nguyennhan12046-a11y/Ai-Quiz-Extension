package groq

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"aiquizforms/internal/config"
	"aiquizforms/internal/fill"
)

type Client struct {
	HTTP *http.Client
}

func (c *Client) httpClient() *http.Client {
	if c != nil && c.HTTP != nil {
		return c.HTTP
	}
	return http.DefaultClient
}

func (c *Client) Answer(ctx context.Context, cfg config.File, questions []fill.Question) ([]fill.Answer, error) {
	cfg = cfg.Normalized()
	if cfg.APIKey == "" {
		return nil, errorsNoKey()
	}
	body := map[string]any{
		"model": cfg.Model,
		"messages": []map[string]string{{
			"role":    "user",
			"content": buildPrompt(questions),
		}},
		"temperature": 0.1,
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	endpoint := cfg.BaseURL + "/v1/chat/completions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("khong goi duoc API: %s", config.Redact(err.Error(), cfg.APIKey))
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("API tra loi %d: %s", resp.StatusCode, config.Redact(string(respBody), cfg.APIKey))
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, fmt.Errorf("API khong tra JSON hop le")
	}
	if len(parsed.Choices) == 0 {
		return nil, fmt.Errorf("API khong co cau tra loi")
	}
	answers := parseAnswers(parsed.Choices[0].Message.Content, questions)
	return answers, nil
}

func errorsNoKey() error {
	return fmt.Errorf("chua co khoa Groq")
}

func buildPrompt(questions []fill.Question) string {
	var b strings.Builder
	b.WriteString("You are answering quiz questions. Answer each question concisely.\n")
	b.WriteString("For multiple choice / checkbox / select / button_choice questions, reply with ONLY the letter(s) of the correct option(s).\n")
	b.WriteString("For text questions, reply with the exact short answer (a word, number, or short phrase).\n")
	b.WriteString("Respond in strict JSON format with an array of objects: [{\"id\": \"...\", \"answer\": \"...\"}]\n\n")
	for _, q := range questions {
		fmt.Fprintf(&b, "Question ID: %s (type: %s)\n%s\n", q.ID, q.Type, q.Text)
		for i, opt := range q.Options {
			fmt.Fprintf(&b, "  %c) %s\n", 'A'+i, opt)
		}
		b.WriteByte('\n')
	}
	return b.String()
}

func parseAnswers(raw string, questions []fill.Question) []fill.Answer {
	start := strings.Index(raw, "[")
	end := strings.LastIndex(raw, "]")
	if start >= 0 && end > start {
		var parsed []struct {
			ID     string `json:"id"`
			Answer any    `json:"answer"`
		}
		if json.Unmarshal([]byte(raw[start:end+1]), &parsed) == nil && len(parsed) > 0 {
			out := make([]fill.Answer, 0, len(parsed))
			for _, item := range parsed {
				out = append(out, fill.Answer{ID: item.ID, Answer: fmt.Sprint(item.Answer)})
			}
			return out
		}
	}
	out := make([]fill.Answer, 0, len(questions))
	for _, q := range questions {
		out = append(out, fill.Answer{ID: q.ID, Answer: ""})
	}
	return out
}
