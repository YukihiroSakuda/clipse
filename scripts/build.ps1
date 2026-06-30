# SnapNote — Release build script
# Usage: pwsh -File scripts/build.ps1
# Output: src-tauri/target/release/bundle/nsis/SnapNote_*.exe

param(
    [switch]$Debug
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Host ">> SnapNote build" -ForegroundColor Cyan

# 1. Frontend
Write-Host "[1/3] Building frontend..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }

# 2. Rust + bundle
Write-Host "[2/3] Building Tauri app..." -ForegroundColor Yellow
if ($Debug) {
    npm run tauri build -- --debug
} else {
    npm run tauri build
}
if ($LASTEXITCODE -ne 0) { throw "Tauri build failed" }

# 3. Show output
Write-Host "[3/3] Build complete!" -ForegroundColor Green
$bundleDir = Join-Path $root "src-tauri\target\release\bundle"
if (Test-Path $bundleDir) {
    Get-ChildItem -Path $bundleDir -Recurse -Include "*.exe","*.msi" |
        Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}, FullName |
        Format-Table -AutoSize
}
