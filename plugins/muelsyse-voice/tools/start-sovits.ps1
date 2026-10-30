# Start the local GPT-SoVITS API server for the Muelsyse voice plugin.
#
# This is the optional path. The default `clips` mode needs no model and no
# network. Only enable translate + SoVITS when you have unpacked the shared
# environment bundle.
#
# Configure either by environment...
#   MUELSYSE_SOVITS_ROOT    e.g. D:\muelsyse-sovits\GPT-SoVITS
#   MUELSYSE_SOVITS_PYTHON  optional; defaults to <Root>\runtime\python.exe
# ...or by parameters:
#   pwsh -NoProfile -File .\start-sovits.ps1 -Root D:\muelsyse-sovits\GPT-SoVITS
#
# The plugin spawns this script with no arguments; environment variables are
# the reliable way to point it at a non-default location.

[CmdletBinding()]
param(
  [string]$Root = $(if ($env:MUELSYSE_SOVITS_ROOT) {
      $env:MUELSYSE_SOVITS_ROOT
    }
    else {
      Join-Path $env:USERPROFILE 'muelsyse-sovits\GPT-SoVITS'
    }),
  [string]$Python = $env:MUELSYSE_SOVITS_PYTHON
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Root)) {
  throw "GPT-SoVITS directory not found: $Root. Set MUELSYSE_SOVITS_ROOT or pass -Root."
}

if ([string]::IsNullOrWhiteSpace($Python)) {
  foreach ($candidate in @(
      (Join-Path $Root 'runtime\python.exe'),
      (Join-Path $Root 'python.exe'),
      (Join-Path $Root 'runtime\python')
    )) {
    if (Test-Path -LiteralPath $candidate) { $Python = $candidate; break }
  }
}
if ([string]::IsNullOrWhiteSpace($Python)) { $Python = 'python' }

$entry = Join-Path $Root 'run_api.py'
if (-not (Test-Path -LiteralPath $entry)) {
  throw "Launcher not found: $entry. Use the GPT-SoVITS bundle linked in README.md."
}

if (-not (Test-Path -LiteralPath $Python) -and -not (Get-Command $Python -ErrorAction SilentlyContinue)) {
  throw "Python not found: $Python. Set MUELSYSE_SOVITS_PYTHON."
}

Write-Host "GPT-SoVITS -> $entry" -ForegroundColor Cyan
Write-Host "python     -> $Python" -ForegroundColor Cyan
Write-Host "API        -> http://127.0.0.1:9880 (override with MUELSYSE_TTS_API)" -ForegroundColor Cyan

& $Python $entry
exit $LASTEXITCODE
