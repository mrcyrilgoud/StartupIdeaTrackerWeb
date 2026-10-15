#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROXY_ROOT="$(cd "${AI_CLI_PROXY_PATH:-$ROOT_DIR/../AI-CLI-Proxy-Server}" 2>/dev/null && pwd || true)"
APP_NAME="Startup Idea Tracker.app"
INSTALL_DIR="/Applications"
APP_PATH="$INSTALL_DIR/$APP_NAME"
NEW_PATH="$INSTALL_DIR/$APP_NAME.new"
CREATE_BACKUP=1
if [[ "${1:-}" == "--no-backup" ]]; then
  CREATE_BACKUP=0
  shift
fi
if [[ $# -ne 0 ]]; then
  echo "Usage: $0 [--no-backup]" >&2
  exit 1
fi
if [[ -z "$PROXY_ROOT" || ! -f "$PROXY_ROOT/server.js" || ! -d "$PROXY_ROOT/node_modules/node-pty" ]]; then
  echo "Companion AI CLI proxy runtime not found. Set AI_CLI_PROXY_PATH to its installed checkout." >&2
  exit 1
fi
if pgrep -f "^$APP_PATH/Contents/MacOS/startup-idea-tracker$" >/dev/null; then
  echo "Quit Startup Idea Tracker before updating its installed bundle." >&2
  exit 1
fi

cd "$ROOT_DIR"
npm run build

STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/startup-idea-tracker.XXXXXX")"
trap 'rm -r -- "$STAGING_DIR"' EXIT
RUNTIME_DIR="$STAGING_DIR/$APP_NAME/Contents/Resources/app"
mkdir -p "$STAGING_DIR/$APP_NAME/Contents/MacOS" "$RUNTIME_DIR/node_modules/@napi-rs"

sed "s|__PROJECT_ROOT__|$ROOT_DIR|g" scripts/macos-wrapper.swift > "$STAGING_DIR/macos-wrapper.swift"
swiftc "$STAGING_DIR/macos-wrapper.swift" -o "$STAGING_DIR/$APP_NAME/Contents/MacOS/startup-idea-tracker" \
  -framework Cocoa -framework WebKit

node_modules/.bin/esbuild server/index.ts --bundle --platform=node --format=esm --target=node18 \
  --external:better-sqlite3 --external:@napi-rs/keyring \
  --banner:js='import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' \
  --outfile="$RUNTIME_DIR/server.mjs"
node_modules/.bin/esbuild "$PROXY_ROOT/server.js" --bundle --platform=node --format=cjs --target=node18 \
  --external:node-pty --external:@napi-rs/keyring --outfile="$RUNTIME_DIR/proxy.cjs"
cp -R dist "$RUNTIME_DIR/dist"
cp package.json "$RUNTIME_DIR/package.json"
cp -R node_modules/better-sqlite3 "$RUNTIME_DIR/node_modules/better-sqlite3"
cp -R node_modules/bindings "$RUNTIME_DIR/node_modules/bindings"
cp -R node_modules/file-uri-to-path "$RUNTIME_DIR/node_modules/file-uri-to-path"
cp -R node_modules/@napi-rs/keyring "$RUNTIME_DIR/node_modules/@napi-rs/keyring"
cp -R node_modules/@napi-rs/keyring-darwin-arm64 "$RUNTIME_DIR/node_modules/@napi-rs/keyring-darwin-arm64"
mkdir -p "$RUNTIME_DIR/node_modules/node-pty/prebuilds"
cp "$PROXY_ROOT/node_modules/node-pty/package.json" "$RUNTIME_DIR/node_modules/node-pty/package.json"
cp -R "$PROXY_ROOT/node_modules/node-pty/lib" "$RUNTIME_DIR/node_modules/node-pty/lib"
cp -R "$PROXY_ROOT/node_modules/node-pty/prebuilds/darwin-arm64" "$RUNTIME_DIR/node_modules/node-pty/prebuilds/darwin-arm64"

APP_SUPPORT_DIR="$HOME/Library/Application Support/Startup Idea Tracker"
APP_SUPPORT_DB="$APP_SUPPORT_DIR/app.sqlite"
if [[ ! -e "$APP_SUPPORT_DB" && -e "$ROOT_DIR/data/app.sqlite" ]]; then
  mkdir -p "$APP_SUPPORT_DIR"
  /opt/homebrew/bin/node -e 'const Database = require("better-sqlite3"); const source = new Database(process.argv[1], { readonly: true }); source.backup(process.argv[2]).then(() => source.close()).catch(error => { console.error(error); process.exitCode = 1; });' \
    "$ROOT_DIR/data/app.sqlite" "$STAGING_DIR/app.sqlite"
  mv "$STAGING_DIR/app.sqlite" "$APP_SUPPORT_DB"
  echo "Migrated app data: $APP_SUPPORT_DB"
fi

cat > "$STAGING_DIR/$APP_NAME/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key><string>Startup Idea Tracker</string>
  <key>CFBundleExecutable</key><string>startup-idea-tracker</string>
  <key>CFBundleIdentifier</key><string>com.startupideatracker.local</string>
  <key>CFBundleName</key><string>Startup Idea Tracker</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

if [[ -e "$NEW_PATH" || -L "$NEW_PATH" ]]; then
  echo "Refusing to overwrite existing staging path: $NEW_PATH" >&2
  exit 1
fi
cp -R "$STAGING_DIR/$APP_NAME" "$NEW_PATH"
codesign --force --deep --sign - "$NEW_PATH" >/dev/null
codesign --verify --deep --strict "$NEW_PATH"

BACKUP_PATH=""
if [[ -e "$APP_PATH" || -L "$APP_PATH" ]]; then
  if [[ "$CREATE_BACKUP" -eq 1 ]]; then
    TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
    BACKUP_PATH="$INSTALL_DIR/$APP_NAME.previous.$TIMESTAMP"
    mv "$APP_PATH" "$BACKUP_PATH"
  else
    rm -r -- "$APP_PATH"
  fi
fi
if ! mv "$NEW_PATH" "$APP_PATH"; then
  if [[ -n "$BACKUP_PATH" && ! -e "$APP_PATH" && ! -L "$APP_PATH" ]]; then
    mv "$BACKUP_PATH" "$APP_PATH"
  fi
  exit 1
fi

codesign --verify --deep --strict "$APP_PATH"
echo "Installed: $APP_PATH"
if [[ -n "$BACKUP_PATH" ]]; then
  echo "Rollback copy: $BACKUP_PATH"
else
  echo "Rollback copy: none"
fi
