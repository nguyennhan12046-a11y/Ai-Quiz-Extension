package forms

import "testing"

func TestOnlyExplicitGoogleFormsPages(t *testing.T) {
	allowed := []string{
		"https://docs.google.com/forms/",
		"https://docs.google.com/forms/d/e/abc/viewform",
		"https://docs.google.com/forms/u/0/d/e/abc/viewform?usp=sharing",
	}
	rejected := []string{
		"http://docs.google.com/forms/d/e/abc/viewform",
		"https://docs.google.com/document/d/abc/edit",
		"https://example.com/forms/d/e/abc/viewform",
		"https://docs.google.com/forms/d/e/abc/formResponse",
		"https://docs.google.com/forms/u/0/d/e/abc/formResponse",
		"javascript:alert(1)",
		"",
	}
	for _, raw := range allowed {
		if !IsGoogleForm(raw) || !IsAllowedNavigation(raw) {
			t.Fatalf("should allow %s", raw)
		}
	}
	for _, raw := range rejected {
		if IsGoogleForm(raw) || IsAllowedNavigation(raw) {
			t.Fatalf("should reject %s", raw)
		}
	}
}
