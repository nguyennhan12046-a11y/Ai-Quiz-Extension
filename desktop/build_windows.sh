#!/bin/sh
set -eu
cd "$(dirname "$0")"
export GOOS=windows
export GOARCH=amd64
export CGO_ENABLED=0
mkdir -p dist
go build -trimpath -ldflags "-s -w -H=windowsgui" -o dist/AIQuizForms.exe ./cmd/aiquiz
file dist/AIQuizForms.exe
sha256sum dist/AIQuizForms.exe
