#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
if pgrep -f "^$APP_PATH/Contents/MacOS/startup-idea-tracker$" >/dev/null; then
  echo "Quit Startup Idea Tracker before updating its installed bundle." >&2
  exit 1
fi

cd "$ROOT_DIR"
npm run build

STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/startup-idea-tracker.XXXXXX")"
trap 'rm -r -- "$STAGING_DIR"' EXIT
mkdir -p "$STAGING_DIR/$APP_NAME/Contents/MacOS" "$STAGING_DIR/$APP_NAME/Contents/Resources"

sed "s|__PROJECT_ROOT__|$ROOT_DIR|g" scripts/macos-wrapper.swift > "$STAGING_DIR/macos-wrapper.swift"
swiftc "$STAGING_DIR/macos-wrapper.swift" -o "$STAGING_DIR/$APP_NAME/Contents/MacOS/startup-idea-tracker" \
  -framework Cocoa -framework WebKit

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
