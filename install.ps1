# Muelsyse · 生态科 — theme pack installer for DeepSeek Harness (Windows).
#
#   pwsh -NoProfile -File .\install.ps1
#   pwsh -NoProfile -File .\install.ps1 -Profile other
#   pwsh -NoProfile -File .\install.ps1 -Purge
#   pwsh -NoProfile -File .\install.ps1 -EnableLegacyHub
#
# What it does, in order:
#   1. copies theme/muelsyse and the three plugins into %DSH_HOME%;
#   2. creates the profile's node_modules junctions;
#   3. appends the theme / voice / persona insert rows to cordis.patch.yml,
#      only when that id is not already present (idempotent).
#
# The profile is watched by HMR. If the GUI does not repaint, reload the page
# or fully restart DSH. The hub package is copied for compatibility, but is
# not inserted by default: theme 0.1.0 already ships the sidebar console.

[CmdletBinding()]
param(
  [string]$Profile = 'desktop',
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }),
  [switch]$Purge,
  [switch]$EnableLegacyHub
)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$profileDir = Join-Path $DshHome "profiles\$Profile"
$patch = Join-Path $profileDir 'cordis.patch.yml'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Repair-Utf8Bom([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -lt 3 -or $bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) { return }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  Copy-Item -LiteralPath $Path -Destination "$Path.bom-bak-$stamp" -Force
  $text = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
  [System.IO.File]::WriteAllText($Path, $text, $utf8)
  Write-Host "bom      -> stripped from $Path (backup: $Path.bom-bak-$stamp)" -ForegroundColor Yellow
}

function Remove-LinkOrDirectory([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($null -eq $item) { return }
  $isLink = [bool]$item.LinkType -or (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
  if ($isLink) {
    try { $item.Delete() }
    catch { Remove-Item -LiteralPath $Path -Force -Recurse }
  }
  else {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

if (-not (Test-Path -LiteralPath $profileDir)) {
  throw "DSH profile not found: $profileDir. Launch DSH once with this profile, then run the installer again."
}

$units = @(
  [pscustomobject]@{
    Label = 'theme/muelsyse'
    Src   = Join-Path $source 'theme\muelsyse'
    Dest  = Join-Path $DshHome 'themes\muelsyse'
    Link  = 'dsh-theme-muelsyse'
  },
  [pscustomobject]@{
    Label = 'plugins/muelsyse-voice'
    Src   = Join-Path $source 'plugins\muelsyse-voice'
    Dest  = Join-Path $DshHome 'plugins\muelsyse-voice'
    Link  = 'dsh-plugin-muelsyse-voice'
  },
  [pscustomobject]@{
    Label = 'plugins/muelsyse-persona'
    Src   = Join-Path $source 'plugins\muelsyse-persona'
    Dest  = Join-Path $DshHome 'plugins\muelsyse-persona'
    Link  = 'dsh-plugin-muelsyse-persona'
  },
  [pscustomobject]@{
    Label = 'plugins/muelsyse-hub'
    Src   = Join-Path $source 'plugins\muelsyse-hub'
    Dest  = Join-Path $DshHome 'plugins\muelsyse-hub'
    Link  = 'dsh-plugin-muelsyse-hub'
  }
)

foreach ($unit in $units) {
  if (-not (Test-Path -LiteralPath (Join-Path $unit.Src 'package.json'))) {
    throw "Package is incomplete, missing: $(Join-Path $unit.Src 'package.json')"
  }
  if ($Purge -and (Test-Path -LiteralPath $unit.Dest)) {
    Remove-LinkOrDirectory $unit.Dest
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $unit.Dest) | Out-Null
  if (Test-Path -LiteralPath $unit.Dest) {
    Remove-LinkOrDirectory $unit.Dest
  }
  Copy-Item -LiteralPath $unit.Src -Destination $unit.Dest -Recurse -Force
  Write-Host "package  -> $($unit.Dest)" -ForegroundColor Green
}

$nodeModules = Join-Path $profileDir 'node_modules'
New-Item -ItemType Directory -Force -Path $nodeModules | Out-Null
foreach ($unit in $units) {
  $linkPath = Join-Path $nodeModules $unit.Link
  Remove-LinkOrDirectory $linkPath
  New-Item -ItemType Junction -Path $linkPath -Target $unit.Dest | Out-Null
  Write-Host "junction -> $linkPath" -ForegroundColor Green
}

# A UTF-8 BOM is a fatal startup error for DSH's strict readers.
Repair-Utf8Bom (Join-Path $profileDir 'package.json')
Repair-Utf8Bom $patch

if (-not (Test-Path -LiteralPath $patch)) {
  [System.IO.File]::WriteAllText(
    $patch,
    "# Your patch layer for this dsh profile, applied after every bundle layer:`n",
    $utf8
  )
}

$raw = [System.IO.File]::ReadAllText($patch)
$nl = if ($raw -match "`r`n") { "`r`n" } else { "`n" }

$blocks = [ordered]@{
  'theme-muelsyse' = @(
    '# ---- theme-muelsyse: 缪尔赛思 · 生态科 ----'
    '- insert:'
    '    - id: theme-muelsyse'
    '      name: dsh-theme-muelsyse'
  ) -join $nl
  'muelsyse-voice' = @(
    '# ---- muelsyse-voice: 缪尔赛思语音（默认切片模式）----'
    '- insert:'
    '    - id: muelsyse-voice'
    '      name: dsh-plugin-muelsyse-voice'
    '      config:'
    '        mode: clips'
    '        thresholdShort: 0.45'
    '        thresholdLong: 0.42'
    '        maxClips: 2'
  ) -join $nl
  'muelsyse-persona' = @(
    '# ---- muelsyse-persona: 缪尔赛思语气 ----'
    '- insert:'
    '    - id: muelsyse-persona'
    '      name: dsh-plugin-muelsyse-persona'
    '      config:'
    '        enabled: true'
  ) -join $nl
}

if ($EnableLegacyHub) {
  $blocks['muelsyse-hub'] = @(
    '# ---- muelsyse-hub: 独立左侧控制台（旧版；主题已内置）----'
    '- insert:'
    '    - id: muelsyse-hub'
    '      name: dsh-plugin-muelsyse-hub'
  ) -join $nl
}

foreach ($id in $blocks.Keys) {
  $pattern = '(?m)^\s*-\s*id:\s*' + [regex]::Escape($id) + '\s*$'
  if ($raw -match $pattern) {
    Write-Host "patch    -> $id already present (left untouched)" -ForegroundColor Yellow
    continue
  }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  Copy-Item -LiteralPath $patch -Destination "$patch.bak-muelsyse-$stamp" -Force
  $prefix = if ($raw.Length -eq 0 -or $raw.EndsWith($nl)) { '' } else { $nl }
  [System.IO.File]::AppendAllText($patch, $prefix + $blocks[$id] + $nl, $utf8)
  $raw = [System.IO.File]::ReadAllText($patch)
  Write-Host "patch    -> appended $id to cordis.patch.yml" -ForegroundColor Green
}

Write-Host ''
Write-Host 'Done. Theme, voice and persona are installed for profile:' -ForegroundColor Cyan
Write-Host "  $Profile" -ForegroundColor Cyan
Write-Host 'The configuration layer is hot-reloaded. If the Web GUI does not' -ForegroundColor Cyan
Write-Host 'repaint, reload the page or fully restart DSH.' -ForegroundColor Cyan
