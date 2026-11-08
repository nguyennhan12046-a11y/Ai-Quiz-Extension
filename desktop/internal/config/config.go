package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

const (
	DefaultBaseURL = "https://api.groq.com/openai"
	DefaultModel   = "openai/gpt-oss-120b"
	DirName        = "AIQuizForms"
)

type File struct {
	Enabled     bool   `json:"enabled"`
	APIKey      string `json:"apiKey"`
	BaseURL     string `json:"baseUrl"`
	Model       string `json:"model"`
	StartInTray bool   `json:"startInTray"`
}

func Default() File {
	return File{
		Enabled: true,
		BaseURL: DefaultBaseURL,
		Model:   DefaultModel,
	}
}

func Dir() (string, error) {
	base := os.Getenv("APPDATA")
	if strings.TrimSpace(base) == "" {
		var err error
		base, err = os.UserConfigDir()
		if err != nil {
			return "", err
		}
	}
	dir := filepath.Join(base, DirName)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

func Path() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.json"), nil
}

func Load() (File, error) {
	path, err := Path()
	if err != nil {
		return File{}, err
	}
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return Default(), nil
	}
	if err != nil {
		return File{}, err
	}
	cfg := Default()
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return File{}, err
	}
	cfg = cfg.Normalized()
	return cfg, nil
}

func (f File) Normalized() File {
	out := f
	out.APIKey = strings.TrimSpace(out.APIKey)
	out.BaseURL = strings.TrimRight(strings.TrimSpace(out.BaseURL), "/")
	out.Model = strings.TrimSpace(out.Model)
	if out.BaseURL == "" {
		out.BaseURL = DefaultBaseURL
	}
	if out.Model == "" {
		out.Model = DefaultModel
	}
	return out
}

func (f File) Save() error {
	path, err := Path()
	if err != nil {
		return err
	}
	cfg := f.Normalized()
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	return file.Sync()
}

func Redact(text, key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return text
	}
	return strings.ReplaceAll(text, key, "[khoa-da-an]")
}
