#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./packages/extension/public/manifest.json').version")
echo "Building store extension v$VERSION ..."
WS_URL=wss://api.skribo.ru/ws API_URL=https://api.skribo.ru CABINET_URL=https://app.skribo.ru EXT_TARGET=store \
  npm run build:extension
OUT="skribo-extension-${VERSION}.zip"
rm -f "$OUT"
( cd packages/extension/dist && zip -qr "../../../$OUT" . )
echo "Packed: $OUT"
