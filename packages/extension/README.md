# LiveScribe Extension

Chrome Extension для real-time транскрибации видеозвонков.

## Development

```bash
# Install dependencies (from root)
npm install

# Build in watch mode
npm run dev

# Production build
npm run build
```

## Loading in Chrome

1. Build the extension: `npm run build`
2. Open Chrome: `chrome://extensions`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select `packages/extension/dist` folder

## Icons (Optional)

The extension will work without icons. To add icons:

1. Create PNG files:
   - `public/icons/icon-16.png` (16x16)
   - `public/icons/icon-48.png` (48x48)
   - `public/icons/icon-128.png` (128x128)

2. Add to `manifest.json`:
```json
"icons": {
  "16": "icons/icon-16.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png"
}
```

## Permissions

- `tabCapture`: Capture audio from browser tabs
- `activeTab`: Access to current tab
- `http://localhost:3001/*`: Connect to local WebSocket server

## Usage

1. Make sure backend is running: `cd packages/backend && npm run dev`
2. Click extension icon in Chrome toolbar
3. Click "Connect to Server"
4. Click "Start Recording" on a tab with audio (e.g., YouTube, Meet)
5. Check backend console for audio chunk logs

## Troubleshooting

### "Failed to start recording"
- Ensure you're on a tab with audio content
- Check that the tab is not muted
- Try refreshing the page

### "Not connected to server"
- Ensure backend is running on `ws://localhost:3001`
- Check browser console for connection errors

### AudioWorklet errors
- The worklet file must be served via `chrome.runtime.getURL()`
- Check that `processor.worklet.js` is in the dist folder
