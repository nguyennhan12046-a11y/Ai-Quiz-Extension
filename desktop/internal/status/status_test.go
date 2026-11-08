package status

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestPublicTextDoesNotIncludeSecretsOrPageData(t *testing.T) {
	const secret = "gsk_test_secret_value"
	const question = "Thủ đô của Việt Nam là gì?"
	samples := []error{
		Err(NoKey),
		Err(Network),
		Err(Timeout),
		Err(HTTP),
		Err(Parse),
		Err(NoForm),
		Err(NoQuestions),
		Err(NoMatch),
		Err(Browser),
		context.DeadlineExceeded,
	}
	for _, err := range samples {
		text := PublicText(err) + CodeOf(err)
		if strings.Contains(text, secret) || strings.Contains(text, question) {
			t.Fatalf("status leaked data: %s", text)
		}
		if strings.Contains(strings.ToLower(text), "thành công") {
			t.Fatalf("error looked like success: %s", text)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Nanosecond)
	defer cancel()
	<-ctx.Done()
	if CodeOf(ctx.Err()) != Timeout {
		t.Fatalf("timeout code = %s", CodeOf(ctx.Err()))
	}
}
