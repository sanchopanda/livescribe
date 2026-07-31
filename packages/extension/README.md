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
- `preRollMs = 1500` (audio before VAD open is buffered and sent)

Thresholds live in `src/content/per-track/core/vad.ts`, the pre-roll window and its buffer in
`src/content/per-track/core/pre-roll.ts` — one place for every platform.

## Development

```bash
# Install dependencies (from repo root)
npm install

# Extension watch mode (→ dist-dev/, localhost backend)
npm run dev:extension

# Same, but pointed at the live backend (→ dist-dev-prod/)
npm run dev:extension:prod

# Full dev (backend + extension)
npm run dev

# All build variants (prod → dist/, dev → dist-dev/, dev+live backend → dist-dev-prod/)
npm run build:extension
```

Backend URLs are baked in at build time by `vite.config.ts`: `BUILD_TARGET` (`prod` default /
`dev`) picks the flavor and output folder, `BACKEND` (`local` / `prod`) picks the URLs, and
`WS_URL` / `API_URL` / `CABINET_URL` override them point-wise (e.g. a LAN IP).

## Loading in Chrome

1. Build the extension: `npm run build:extension`
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `packages/extension/dist` — or `dist-dev` / `dist-dev-prod`, which install as
   "Skribo (dev)" / "Skribo (dev → prod)" and can coexist with the prod build

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
