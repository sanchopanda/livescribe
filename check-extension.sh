#!/bin/bash
# Проверка установки расширения

echo "📋 Checking extension build..."
echo ""

# Проверяем файлы
if [ -f "packages/extension/dist/src/content/platform-research.js" ]; then
    echo "✅ platform-research.js exists"
    echo "   Size: $(wc -c < packages/extension/dist/src/content/platform-research.js) bytes"
else
    echo "❌ platform-research.js NOT FOUND"
fi

if [ -f "packages/extension/dist/manifest.json" ]; then
    echo "✅ manifest.json exists"
else
    echo "❌ manifest.json NOT FOUND"
fi

echo ""
echo "📦 Checking manifest content_scripts:"
cat packages/extension/dist/manifest.json | grep -A 15 '"content_scripts"' | head -20

echo ""
echo "🔍 Next steps:"
echo "1. Open chrome://extensions in your browser"
echo "2. Find LiveScribe extension"
echo "3. Check if it's enabled"
echo "4. Note the extension ID"
echo "5. Reload the extension (click refresh button)"
echo "6. Close and reopen Zoom tab"
echo "7. Open DevTools (F12)"
echo "8. Type: typeof startTracking"
echo ""
