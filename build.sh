#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

export APPIMAGE_EXTRACT_AND_RUN=1
export NO_STRIP=true

echo "[EasyNet] Checking build dependencies..."

install_linux_deps() {
  if command -v apt >/dev/null; then
    sudo apt update
    sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
      libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
  elif command -v pacman >/dev/null; then
    sudo pacman -S --needed --noconfirm webkit2gtk-4.1 base-devel curl wget file \
      openssl gtk3 libayatana-appindicator librsvg
  elif command -v dnf >/dev/null; then
    sudo dnf install -y webkit2gtk4.1-devel openssl-devel curl wget file \
      libappindicator-gtk3-devel librsvg2-devel gcc gcc-c++ make
  fi
}

install_linux_deps

if ! command -v cargo >/dev/null; then
  echo "[EasyNet] Installing Rust..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  . "$HOME/.cargo/env"
fi

if ! command -v node >/dev/null; then
  echo "[EasyNet] Node.js not found. Install Node 18+ and re-run." >&2
  exit 1
fi

npm install

if [ ! -f src-tauri/icons/icon.png ]; then
  echo "[EasyNet] Generating icons..."
  npm run tauri icon ./icon.png
fi

echo "[EasyNet] Building..."
npm run build

mkdir -p Binaries
APPIMAGE="$(find src-tauri/target -name '*.AppImage' | head -n 1 || true)"
if [ -n "$APPIMAGE" ]; then
  cp "$APPIMAGE" "Binaries/easynet-1.1.AppImage"
  chmod +x "Binaries/easynet-1.1.AppImage"
  echo "[EasyNet] -> Binaries/easynet-1.1.AppImage"
else
  echo "[EasyNet] AppImage not found; copying raw binary."
  cp src-tauri/target/release/easynet "Binaries/easynet-1.1"
fi

echo "[EasyNet] Done."
