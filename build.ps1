$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "[EasyNet] Checking build dependencies..."

function Need($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

if (-not (Need "cargo")) {
  Write-Host "[EasyNet] Installing Rust..."
  winget install -e --id Rustlang.Rustup --accept-source-agreements --accept-package-agreements
  $env:Path += ";$env:USERPROFILE\.cargo\bin"
}

if (-not (Need "node")) {
  Write-Host "[EasyNet] Installing Node.js..."
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  $env:Path += ";$env:ProgramFiles\nodejs"
}

npm install

if (-not (Test-Path "src-tauri/icons/icon.ico")) {
  Write-Host "[EasyNet] Generating icons..."
  npm run tauri icon ./icon.png
}

Write-Host "[EasyNet] Building..."
npm run build

New-Item -ItemType Directory -Force -Path "Binaries" | Out-Null

$exe = Get-ChildItem -Path "src-tauri/target/release/bundle" -Recurse -Filter "*-setup.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) {
  $exe = Get-ChildItem -Path "src-tauri/target/release/bundle/nsis" -Recurse -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
}
if ($exe) {
  Copy-Item $exe.FullName "Binaries/easynet-1.1.exe" -Force
  Write-Host "[EasyNet] -> Binaries/easynet-1.1.exe"
} else {
  $msi = Get-ChildItem -Path "src-tauri/target/release/bundle/msi" -Recurse -Filter "*.msi" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($msi) { Copy-Item $msi.FullName "Binaries/easynet-1.1.msi" -Force; Write-Host "[EasyNet] -> Binaries/easynet-1.1.msi" }
}

Write-Host "[EasyNet] Done."
