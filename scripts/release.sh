#!/usr/bin/env bash
# Build locally, upload to a draft, then publish the package version on GitHub.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$(uname -s)" != Darwin ]; then
  echo 'Releases must be built on macOS.' >&2
  exit 1
fi
command -v gh >/dev/null
gh auth status
if [ -n "$(git status --porcelain)" ]; then
  echo 'Commit or stash changes before releasing.' >&2
  exit 1
fi

VERSION=$(node -p "require('./package.json').version")
PRODUCT_NAME=$(node -p "require('./package.json').productName")
TAG="v${VERSION}"
RELEASE_NOTE="${1:-}"

if IS_DRAFT=$(gh release view "$TAG" --json isDraft -q '.isDraft' 2>/dev/null); then
  if [ "$IS_DRAFT" != true ]; then
    echo "Release $TAG is already public; bump package.json's version first." >&2
    exit 1
  fi
else
  IS_DRAFT=false
fi
if TAG_COMMIT=$(git rev-parse -q --verify "refs/tags/${TAG}^{commit}"); then
  if [ "$TAG_COMMIT" != "$(git rev-parse HEAD)" ]; then
    echo "Tag $TAG points to another commit; bump the version first." >&2
    exit 1
  fi
fi
if [ -z "$RELEASE_NOTE" ]; then
  if [ ! -t 0 ]; then
    echo 'Usage: npm run release -- "Release notes"' >&2
    exit 1
  fi
  read -rp 'Release statement: ' RELEASE_NOTE
fi
if [ -z "$RELEASE_NOTE" ]; then
  echo 'Release notes must not be empty.' >&2
  exit 1
fi

npm test
npm run typecheck
# Remove the expected artifacts so old files cannot satisfy this release.
ZIP_PATH="out/make/zip/darwin/arm64/${PRODUCT_NAME}-darwin-arm64-${VERSION}.zip"
DMG_PATH="out/make/${PRODUCT_NAME}-darwin-arm64-${VERSION}.dmg"
rm -f "$ZIP_PATH" "$DMG_PATH"
Y_TERM_RELEASE=1 npm run make
if [ ! -s "$ZIP_PATH" ]; then
  echo "Build did not produce $ZIP_PATH" >&2
  exit 1
fi
if [ ! -s "$DMG_PATH" ]; then
  echo "Build did not produce $DMG_PATH" >&2
  exit 1
fi
bash scripts/notarize-dmg.sh

if [ -z "${TAG_COMMIT:-}" ]; then
  git tag -a "$TAG" -m "$RELEASE_NOTE"
fi
git push origin "refs/tags/$TAG"
if [ "$IS_DRAFT" != true ]; then
  gh release create "$TAG" --draft --verify-tag --title "$TAG" --notes "$RELEASE_NOTE"
fi
gh release upload "$TAG" "$ZIP_PATH" "$DMG_PATH" --clobber
gh release edit "$TAG" --draft=false --latest --notes "$RELEASE_NOTE"
echo "Released $TAG"
