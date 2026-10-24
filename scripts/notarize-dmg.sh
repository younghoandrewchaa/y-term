#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
PRODUCT_NAME=$(node -p "require('./package.json').productName")
APP_PATH="out/${PRODUCT_NAME}-darwin-arm64/${PRODUCT_NAME}.app"
DMG_PATH="out/make/${PRODUCT_NAME}-darwin-arm64-${VERSION}.dmg"

# Forge notarizes and staples the app before creating either distributable.
codesign --verify --deep --strict "$APP_PATH"
xcrun stapler validate "$APP_PATH"
spctl --assess --type execute "$APP_PATH"

IDENTITY="${APPLE_SIGN_IDENTITY:-}"
if [ -z "$IDENTITY" ]; then
  IDENTITY=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -n 1)
fi
if [ -z "$IDENTITY" ]; then
  echo 'No Developer ID Application signing identity found.' >&2
  exit 1
fi
codesign --force --timestamp --sign "$IDENTITY" "$DMG_PATH"
codesign --verify --strict "$DMG_PATH"

if [ -n "${APPLE_ID:-}" ]; then
  : "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID}"
  PASSWORD="${APPLE_APP_SPECIFIC_PASSWORD:-${APPLE_ID_PASSWORD:-}}"
  : "${PASSWORD:?Set APPLE_APP_SPECIFIC_PASSWORD}"
  AUTH=(--apple-id "$APPLE_ID" --password "$PASSWORD" --team-id "$APPLE_TEAM_ID")
else
  # Reuse the reference project's saved credentials; override for another profile.
  AUTH=(--keychain-profile "${APPLE_KEYCHAIN_PROFILE:-m-note}")
fi
RESULT=$(mktemp)
trap 'rm -f "$RESULT"' EXIT
xcrun notarytool submit "$DMG_PATH" "${AUTH[@]}" --wait --output-format json > "$RESULT"
node --input-type=module - "$RESULT" <<'NODE'
import { readFileSync } from 'node:fs';
const result = JSON.parse(readFileSync(process.argv[2], 'utf8'));
console.log(`DMG notarization: ${result.status} (${result.id || 'no submission ID'})`);
if (result.status !== 'Accepted') process.exit(1);
NODE
xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"
spctl --assess --type open --context context:primary-signature "$DMG_PATH"
