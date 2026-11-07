# Packages the extension for production (Chrome Web Store upload).
#
#   Usage (from the project folder):
#     npm run build
#     powershell -ExecutionPolicy Bypass -File scripts\build.ps1 [-SkipTests]
#
#   Output:
#     dist\yad2-private-filter-<version>\       unpacked copy (Load unpacked to test it)
#     dist\yad2-private-filter-<version>.zip    upload this to the Chrome Web Store
#
# Steps
#   1. Validate manifest.json (required fields, version format, limits).
#   2. Collect the files the manifest references (scripts, styles, icons, the
#      popup) plus the files those HTML pages load, and check they exist.
#      Only these files ship: no tests, node_modules, etc.
#   3. Check every script parses (node --check) and icons have the right size.
#   4. Run the tests (skip with -SkipTests).
#   5. Copy the files to dist\ and zip them.
#
# Any failed check stops the build with a message saying what to fix.

param([switch]$SkipTests)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$problems = New-Object System.Collections.Generic.List[string]
function Step($text) { Write-Host "`n> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "  ok  $text" -ForegroundColor Green }
function Problem($text) { $problems.Add($text); Write-Host "  !!  $text" -ForegroundColor Red }
function Stop-IfProblems {
  if ($problems.Count -gt 0) {
    Write-Host "`nBuild failed: $($problems.Count) problem(s) above." -ForegroundColor Red
    exit 1
  }
}

# ─── 1. Manifest ────────────────────────────────────────────────────────────
Step "Checking manifest.json"

try {
  $manifest = Get-Content manifest.json -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
  Problem "manifest.json is not valid JSON: $($_.Exception.Message)"
  Stop-IfProblems
}

if ($manifest.manifest_version -ne 3) { Problem "manifest_version must be 3 (found '$($manifest.manifest_version)')." }

foreach ($field in "name", "version", "description") {
  if (-not $manifest.$field) { Problem "manifest.json is missing '$field'." }
}
# Limits enforced by Chrome / the Web Store.
if ($manifest.name -and $manifest.name.Length -gt 75) { Problem "name is $($manifest.name.Length) characters; max is 75." }
if ($manifest.description -and $manifest.description.Length -gt 132) {
  Problem "description is $($manifest.description.Length) characters; the Web Store max is 132."
}

# Version: 1-4 dot-separated whole numbers, each 0-65535, no leading zeros.
$version = "$($manifest.version)"
$parts = $version.Split(".")
$versionOk = $parts.Count -ge 1 -and $parts.Count -le 4
foreach ($p in $parts) {
  if ($p -notmatch '^(0|[1-9]\d{0,4})$' -or [int]$p -gt 65535) { $versionOk = $false }
}
if (-not $versionOk) { Problem "version '$version' is invalid; use 1 to 4 numbers like 1.0.0." }

if (-not $manifest.icons) { Problem "manifest.json has no 'icons'; the Web Store requires a 128px icon." }
elseif (-not $manifest.icons.'128') { Problem "icons has no '128' entry; the Web Store requires it." }

Stop-IfProblems
Ok "$($manifest.name) v$version"

# ─── 2. Files referenced by the manifest ────────────────────────────────────
Step "Collecting files referenced by the manifest"

$files = New-Object System.Collections.Generic.List[string]
$files.Add("manifest.json")
foreach ($cs in @($manifest.content_scripts)) {
  foreach ($f in @($cs.js) + @($cs.css)) { if ($f) { $files.Add($f) } }
}
$iconFiles = @{}
foreach ($prop in @($manifest.icons.PSObject.Properties)) {
  $files.Add($prop.Value); $iconFiles[$prop.Value] = [int]$prop.Name
}
if ($manifest.action.default_icon) {
  if ($manifest.action.default_icon -is [string]) { $files.Add($manifest.action.default_icon) }
  else { foreach ($prop in @($manifest.action.default_icon.PSObject.Properties)) { $files.Add($prop.Value); $iconFiles[$prop.Value] = [int]$prop.Name } }
}
if ($manifest.action.default_popup) { $files.Add($manifest.action.default_popup) }
if ($manifest.background.service_worker) { $files.Add($manifest.background.service_worker) }
if ($manifest.options_page) { $files.Add($manifest.options_page) }

$files = @($files | ForEach-Object { $_ -replace '\\', '/' } | Sort-Object -Unique)

# HTML pages (e.g. the popup) load their own scripts, styles and images.
# Add every local src="..." / href="..." they reference.
foreach ($page in @($files | Where-Object { $_ -like "*.html" })) {
  if (-not (Test-Path -LiteralPath $page)) { continue } # reported as missing below
  $html = Get-Content -LiteralPath $page -Raw -Encoding UTF8
  $pageDir = Split-Path $page -Parent
  foreach ($m in [regex]::Matches($html, '(?:src|href)\s*=\s*"([^"#?]+)')) {
    $ref = $m.Groups[1].Value
    if ($ref -match '^(?:[a-z]+:|//)') { continue } # http:, data:, chrome:, etc.
    $path = if ($pageDir) { "$pageDir/$ref" } else { $ref }
    $files += ($path -replace '\\', '/' -replace '^\./', '')
  }
}
$files = @($files | Sort-Object -Unique)

foreach ($f in $files) {
  if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { Problem "manifest references '$f', but the file doesn't exist." }
  # Chrome refuses to load files or folders whose names start with "_".
  elseif (($f -split '/') | Where-Object { $_.StartsWith("_") }) { Problem "'$f': names starting with '_' are reserved by Chrome." }
  else { Ok $f }
}
Stop-IfProblems

# ─── 3. Scripts parse, icons have the right size ────────────────────────────
Step "Checking scripts and icons"

$node = Get-Command node -ErrorAction SilentlyContinue
foreach ($f in $files | Where-Object { $_ -like "*.js" }) {
  if (-not $node) { Write-Host "  --  node not found, skipping syntax check of $f" -ForegroundColor Yellow; continue }
  $out = & node --check $f 2>&1
  if ($LASTEXITCODE -ne 0) { Problem "$f has a syntax error:`n$out" } else { Ok "$f parses" }
}

foreach ($f in $iconFiles.Keys) {
  $img = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $f).Path)
  $w = $img.Width; $h = $img.Height; $img.Dispose()
  $expected = $iconFiles[$f]
  if ($w -ne $expected -or $h -ne $expected) { Problem "$f is ${w}x${h}, but the manifest lists it as ${expected}px." }
  else { Ok "$f is ${w}x${h}" }
}
Stop-IfProblems

# ─── 4. Tests ───────────────────────────────────────────────────────────────
if ($SkipTests) {
  Step "Skipping tests (-SkipTests)"
} else {
  Step "Running tests"
  if (-not (Test-Path node_modules)) {
    Problem "node_modules is missing; run 'npm install' first (or use -SkipTests)."
    Stop-IfProblems
  }
  $testOutput = & node --test tests/ 2>&1
  if ($LASTEXITCODE -ne 0) {
    $testOutput | ForEach-Object { Write-Host "  $_" }
    Problem "tests failed (output above)."
    Stop-IfProblems
  }
  $summary = ($testOutput | Select-String '^# (pass|fail) ') -join ", "
  Ok ($summary -replace '# ', '')
}

# ─── 5. Copy and zip ────────────────────────────────────────────────────────
Step "Packaging"

$packageName = "yad2-private-filter-$version"
$dist = Join-Path $root "dist"
$outDir = Join-Path $dist $packageName
$zipPath = Join-Path $dist "$packageName.zip"

if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir }
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
New-Item -ItemType Directory -Force $outDir | Out-Null

foreach ($f in $files) {
  $target = Join-Path $outDir $f
  New-Item -ItemType Directory -Force (Split-Path $target -Parent) | Out-Null
  Copy-Item -LiteralPath $f -Destination $target
}

# Build the zip entry by entry so paths use "/" (Compress-Archive in Windows
# PowerShell can write "\", which other systems read as part of a file name).
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($f in $files) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, (Join-Path $outDir $f), $f, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
}

$sizeKb = [Math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Ok "dist\$packageName\  (unpacked, $($files.Count) files)"
Ok "dist\$packageName.zip  ($sizeKb KB)"

Write-Host "`nBuild succeeded." -ForegroundColor Green
Write-Host "  Test it:   chrome://extensions > Load unpacked > dist\$packageName"
Write-Host "  Publish:   upload dist\$packageName.zip at https://chrome.google.com/webstore/devconsole"
Write-Host "  Next release: raise 'version' in manifest.json first; the Web Store rejects a version it has already seen."
