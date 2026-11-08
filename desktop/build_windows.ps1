$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:GOOS = "windows"
$env:GOARCH = "amd64"
$env:CGO_ENABLED = "0"
New-Item -ItemType Directory -Force -Path dist | Out-Null
go build -trimpath -ldflags "-s -w -H=windowsgui" -o dist/AIQuizForms.exe ./cmd/aiquiz
Get-FileHash dist/AIQuizForms.exe -Algorithm SHA256
