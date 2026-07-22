# LiveScribe Extension

Chrome extension for real-time transcription in video calls.

## What is implemented

- Two audio modes:
  - `mixed` - full tab capture via `chrome.tabCapture`
  - `per-track` - per-participant WebRTC track capture (Pachca)
- Real-time transcript rendering in page widget.
- Recording/session controls:
  - `Start` continues recording,
  - `Stop` pauses without clearing,
  - `Reset` clears transcript and counters.
- Live runtime indicators in widget:
  - recording duration,
  - cumulative Deepgram sent duration,
  - audio levels:
    - `mixed`: single current level,
    - `per-track`: speaker list with per-speaker levels,
  - WebSocket state (`recovering` / `recovered`).

## Per-track VAD settings

- `rmsOn = 0.02`
- `rmsOff = 0.01`
- `peakOverride = 0.12`
- `hangoverMs = 1000`
- `preRollMs = 500` (audio before VAD open is buffered and sent)

## Development

```bash
# Install dependencies (from repo root)
npm install

# Extension watch mode
npm run dev:extension

# Full dev (backend + extension)
npm run dev

# Production build
npm run build:extension
```

## Loading in Chrome

1. Build the extension: `npm run build:extension`
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `packages/extension/dist`

## Permissions

- `tabCapture` - capture tab audio in mixed mode
- `activeTab` - access current tab for widget/runtime messaging
- `offscreen` - offscreen audio processing for mixed pipeline
- host permissions for supported platforms (Meet/Zoom/Teams/Pachca)
- backend URL access (`ws://localhost:3001/*` by default in dev)

## Troubleshooting

### "Cannot capture a tab with an active stream"

- Stop previous capture session first.
- If extension was updated, reload the meeting tab.

### UI does not open or content script errors

- Rebuild extension and reload in `chrome://extensions`.
- Reload target page after extension update.

### No transcript but levels are moving

- Check backend/WebSocket status in widget (`WS recovering...`).
- Verify backend is running and `DEEPGRAM_API_KEY` is configured.
