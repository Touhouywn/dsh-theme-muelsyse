# Start the local GPT-SoVITS server for the Muelsyse voice plugin.
#
# The shared columbina launcher resolves its defaults as
#   $PSScriptRoot\..\.runtime\...  ->  columbina\.assets-src\.runtime\...
# which does not exist; the real runtime lives at columbina\.runtime\.
# This copy pins the real paths so the plugin can spawn it without args.
#
#   pwsh -NoProfile -File .\start-sovits.ps1

[CmdletBinding()]
param(
  [int]$Port = 9880,
  [string]$Root = 'E:\AI-theme\columbina\.runtime\GPT-SoVITS',
  [string]$Python = 'E:\AI-theme\columbina\.runtime\python310\python.exe'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Python)) { throw "Python not found: $Python" }
if (-not (Test-Path -LiteralPath $Root)) { throw "GPT-SoVITS not found: $Root" }

Write-Host "serving on http://127.0.0.1:$Port" -ForegroundColor Cyan
& $Python "$Root\run_api.py"
