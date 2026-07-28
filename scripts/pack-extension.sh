#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./packages/extension/public/manifest.json').version")
echo "Building store extension v$VERSION ..."
# Store target: prod URLs (now the default) + narrowed manifest (EXT_TARGET=store),
# built into its own folder so it never clobbers dist/ (prod) or dist-dev/.
EXT_TARGET=store EXT_OUT=dist-store \
  WS_URL=wss://api.skribo.ru/ws API_URL=https://api.skribo.ru CABINET_URL=https://app.skribo.ru \
  npm run build --workspace=@skribo/extension
OUT="skribo-extension-${VERSION}.zip"
rm -f "$OUT"
( cd packages/extension/dist-store && zip -qr "../../../$OUT" . )
echo "Packed: $OUT"
