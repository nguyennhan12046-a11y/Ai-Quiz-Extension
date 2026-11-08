package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultAndRoundTripDoesNotEchoKey(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("APPDATA", dir)
	cfg := Default()
	if cfg.Enabled != true || cfg.BaseURL != DefaultBaseURL || cfg.Model != DefaultModel {
		t.Fatalf("defaults = %+v", cfg)
	}
	if cfg.APIKey != "" {
		t.Fatal("default key must be empty")
	}
	cfg.APIKey = "gsk_test_secret_value"
	cfg.BaseURL = "https://api.groq.com/openai/"
	if err := cfg.Save(); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, DirName, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.APIKey != "gsk_test_secret_value" {
		t.Fatalf("key not restored")
	}
	if loaded.BaseURL != DefaultBaseURL || loaded.Model != DefaultModel {
		t.Fatalf("normalized = %+v", loaded)
	}
	info, err := os.Stat(filepath.Join(dir, DirName, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o077 != 0 {
		t.Fatalf("config should not be group/world readable: %v", info.Mode())
	}
	logged := Redact("failed for key gsk_test_secret_value", loaded.APIKey)
	if logged == string(raw) || contains(logged, "gsk_test_secret_value") {
		t.Fatalf("log leaked key: %s", logged)
	}
}

func TestMissingFileDefaultsOn(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Enabled {
		t.Fatal("missing config should default to enabled")
	}
}

func contains(s, part string) bool {
	return len(part) > 0 && len(s) >= len(part) && (s == part || len(s) > 0 && (stringIndex(s, part) >= 0))
}

func stringIndex(s, part string) int {
	for i := 0; i+len(part) <= len(s); i++ {
		if s[i:i+len(part)] == part {
			return i
		}
	}
	return -1
}
