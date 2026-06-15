#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

VER="1.1"
OUT="$ROOT/Binaries"

export APPIMAGE_EXTRACT_AND_RUN=1
export NO_STRIP=true

if ! command -v cargo >/dev/null; then
  echo "[EasyNet] Rust not found. Install Rust and re-run." >&2
  exit 1
fi
if ! command -v node >/dev/null; then
  echo "[EasyNet] Node.js not found. Install Node 18+ and re-run." >&2
  exit 1
fi

npm install

if [ ! -f src-tauri/icons/icon.png ]; then
  npm run tauri icon ./icon.png
fi

rm -rf "$OUT"
mkdir -p "$OUT"

copy_first() {
  local root="$1" pat="$2" dest="$3" f
  f="$(find "$root" -type f -name "$pat" 2>/dev/null | head -n1)"
  if [ -n "$f" ]; then
    cp -f "$f" "$dest"
    echo "[EasyNet] -> $dest"
  else
    echo "[EasyNet] (skip) $pat not found in $root"
  fi
}

echo "[EasyNet] Building Linux bundles (deb, rpm, AppImage)..."
npm run build

copy_first "src-tauri/target/release/bundle" '*.deb' "$OUT/easynet-$VER.deb"
copy_first "src-tauri/target/release/bundle" '*.rpm' "$OUT/easynet-$VER.rpm"
copy_first "src-tauri/target/release/bundle" '*.AppImage' "$OUT/easynet-$VER.AppImage"
chmod +x "$OUT/easynet-$VER.AppImage" 2>/dev/null || true

echo "[EasyNet] Cross-building Windows .exe..."
if command -v cargo-xwin >/dev/null && rustup target list --installed 2>/dev/null | grep -q x86_64-pc-windows-msvc; then
  npm run build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis || true
  WIN_DIR="src-tauri/target/x86_64-pc-windows-msvc/release"
  EXE="$(find "$WIN_DIR/bundle/nsis" -type f -name '*-setup.exe' 2>/dev/null | head -n1)"
  [ -z "$EXE" ] && EXE="$WIN_DIR/easynet.exe"
  if [ -f "$EXE" ]; then
    cp -f "$EXE" "$OUT/easynet-$VER.exe"
    echo "[EasyNet] -> $OUT/easynet-$VER.exe"
  else
    echo "[EasyNet] (skip) windows exe not produced"
  fi
else
  echo "[EasyNet] (skip) windows: need cargo-xwin and target x86_64-pc-windows-msvc"
fi

echo "[EasyNet] Building ARM64 binary (best effort)..."
if rustup target list --installed 2>/dev/null | grep -q aarch64-unknown-linux-gnu && command -v aarch64-linux-gnu-gcc >/dev/null; then
  if cargo build --release --manifest-path src-tauri/Cargo.toml --target aarch64-unknown-linux-gnu; then
    ARM="src-tauri/target/aarch64-unknown-linux-gnu/release/easynet"
    if [ -f "$ARM" ]; then
      cp -f "$ARM" "$OUT/easynet-$VER.arm64"
      echo "[EasyNet] -> $OUT/easynet-$VER.arm64"
    fi
  else
    echo "[EasyNet] (skip) arm64 build failed (needs aarch64 webkit2gtk sysroot)"
  fi
else
  echo "[EasyNet] (skip) arm64: need target aarch64-unknown-linux-gnu + aarch64-linux-gnu-gcc + arm webkit2gtk"
fi

echo "[EasyNet] Done. Artifacts in $OUT:"
ls -la "$OUT"
