<#
.SYNOPSIS
    Builds TypeKernel for Windows (.exe NSIS installer and/or portable executable).

.DESCRIPTION
    Verifies required build toolchains (Node.js, pnpm, Rust/Cargo, MSVC),
    runs frontend compilation (TypeScript + Vite), and invokes Tauri CLI
    to produce the production Windows .exe installer.

.PARAMETER PortableOnly
    If specified, builds only the standalone portable .exe without packaging an installer.

.EXAMPLE
    .\scripts\build-windows.ps1
    .\scripts\build-windows.ps1 -PortableOnly
#>

[CmdletBinding()]
param(
    [switch]$PortableOnly
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " TypeKernel Windows Build Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. Verify Node.js
try {
    $nodeVer = node --version
    Write-Host "[OK] Node.js found: $nodeVer" -ForegroundColor Green
} catch {
    Write-Error "Node.js is not installed or not in PATH. Please install Node.js (v18+)."
    exit 1
}

# 2. Verify pnpm
$pnpmCmd = "pnpm"
if (Get-Command "pnpm.cmd" -ErrorAction SilentlyContinue) {
    $pnpmCmd = "pnpm.cmd"
} elseif (-not (Get-Command "pnpm" -ErrorAction SilentlyContinue)) {
    Write-Error "pnpm is not found. Install it via 'npm install -g pnpm' or 'corepack enable'."
    exit 1
}
Write-Host "[OK] Using package manager: $pnpmCmd" -ForegroundColor Green

# 3. Verify Rust / Cargo
$cargoCmd = Get-Command "cargo" -ErrorAction SilentlyContinue
if (-not $cargoCmd -and (Test-Path "$env:USERPROFILE\.cargo\bin\cargo.exe")) {
    $env:PATH = "$env:USERPROFILE\.cargo\bin;" + $env:PATH
    $cargoCmd = Get-Command "cargo" -ErrorAction SilentlyContinue
}

if (-not $cargoCmd) {
    Write-Host "`n[ERROR] Rust / Cargo toolchain is not found." -ForegroundColor Red
    Write-Host "To build on Windows, install Rust via rustup:" -ForegroundColor Yellow
    Write-Host "  winget install Rustlang.Rustup" -ForegroundColor Yellow
    Write-Host "Or download rustup-init.exe from https://rustup.rs/" -ForegroundColor Yellow
    Write-Host "Make sure to choose the 'MSVC' toolchain (x86_64-pc-windows-msvc) and install" -ForegroundColor Yellow
    Write-Host "'Desktop development with C++' via Visual Studio Build Tools if not present.`n" -ForegroundColor Yellow
    exit 1
}

$rustVer = rustc --version
Write-Host "[OK] Rust compiler found: $rustVer" -ForegroundColor Green

# 4. Build Frontend
Write-Host "`n[1/2] Building frontend (tsc && vite build)..." -ForegroundColor Yellow
& $pnpmCmd run build
if ($LASTEXITCODE -ne 0) {
    Write-Error "Frontend build failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}
Write-Host "[OK] Frontend build succeeded." -ForegroundColor Green

# 5. Build Tauri Windows Executable
Write-Host "`n[2/2] Building Tauri Windows application..." -ForegroundColor Yellow
if ($PortableOnly) {
    Write-Host "Running: $pnpmCmd run build:windows:portable" -ForegroundColor Gray
    & $pnpmCmd run build:windows:portable
} else {
    Write-Host "Running: $pnpmCmd run build:windows" -ForegroundColor Gray
    & $pnpmCmd run build:windows
}

if ($LASTEXITCODE -ne 0) {
    Write-Error "Tauri Windows build failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}

# 6. Report outputs
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " Build Complete! Artifacts:" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$releaseDir = Join-Path $PSScriptRoot "..\src-tauri\target\release"
$nsisDir = Join-Path $releaseDir "bundle\nsis"

$installer = Get-ChildItem -Path $nsisDir -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($installer) {
    $sizeMb = [math]::Round($installer.Length / 1MB, 2)
    Write-Host "Installer (.exe) : $($installer.FullName) ($sizeMb MB)" -ForegroundColor Green
}

$standalone = Join-Path $releaseDir "typekernel.exe"
if (Test-Path $standalone) {
    $fileItem = Get-Item $standalone
    $sizeMb = [math]::Round($fileItem.Length / 1MB, 2)
    Write-Host "Executable (.exe): $standalone ($sizeMb MB)" -ForegroundColor Green
}

Write-Host "`nYou can run the installer on any Windows 10/11 system to install TypeKernel." -ForegroundColor Cyan
