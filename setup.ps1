# ClipsReal — instalação (Windows / PowerShell)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "==> Python venv" -ForegroundColor Cyan
if (-not (Test-Path ".venv")) { python -m venv .venv }
.\.venv\Scripts\python.exe -m pip install --upgrade pip -q
.\.venv\Scripts\pip.exe install -r requirements.txt -q

Write-Host "==> FFmpeg" -ForegroundColor Cyan
$ff = Get-Command ffmpeg -ErrorAction SilentlyContinue
$wingetFF = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\ffmpeg.exe"
$pkgFF = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\Gyan.FFmpeg*") -Filter "ffmpeg.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ff -and -not (Test-Path $wingetFF) -and -not $pkgFF) {
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements --silent
}

if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env"; Write-Host "Criado .env — coloque sua GEMINI_API_KEY" -ForegroundColor Yellow }
New-Item -ItemType Directory -Force -Path credentials, data | Out-Null

Write-Host "==> Diagnóstico" -ForegroundColor Cyan
.\.venv\Scripts\python.exe -m clipsreal doctor
Write-Host "`nPronto! Rode .\run.ps1 e abra http://localhost:8000" -ForegroundColor Green
