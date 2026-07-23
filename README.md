# Skribo

Real-time transcription for video calls (Google Meet, Zoom, MS Teams, Pachca).

> Продукт переименован из «LiveScribe» в **Skribo** (см. `docs/decisions/0004-product-name-skribo.md`).
> Идентификаторы пакетов `@livescribe/*` временно сохранены — переименование в `@skribo/*`
> запланировано отдельной задачей LS-10.

## Architecture

Monorepo structure with npm workspaces:
- `packages/extension` - Chrome Extension (React + TypeScript)
- `packages/backend` - WebSocket server (Node.js + Fastify)
- `packages/shared` - Shared TypeScript types

### Platform-aware audio modes

- `mixed` mode: capture full tab audio via `chrome.tabCapture`.
- `per-track` mode: capture separate participant WebRTC tracks (Pachca, Google Meet).

Mode availability is capability-driven per platform in
`packages/extension/src/platform/audio-mode-capabilities.ts`.

`start` WebSocket payload includes optional `platform` and `audioMode`.

### Current recording UX

- `Stop` pauses recording/transcription state (does not clear transcript/timers).
- `Reset` clears transcript and accumulated counters.
- UI shows:
  - recording duration;
  - cumulative audio seconds sent to Deepgram;
  - live audio levels:
    - `mixed`: one current track level;
    - `per-track`: participant list with per-speaker levels.
- UI shows WebSocket recovery state (`WS recovering...` / `WS recovered`).

### Per-track VAD behavior

- Speech open threshold: `rmsOn = 0.02`
- Speech close threshold: `rmsOff = 0.01`
- Peak override: `peakOverride = 0.12`
- Hangover window: `1000ms`
- Pre-roll before open: `500ms` buffered audio (to reduce clipped starts)

## Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0

## Installation

```bash
npm install
```

## Development

```bash
# Run backend + extension in watch mode
npm run dev

# Or run separately:
npm run dev:backend   # Backend on ws://localhost:3001
npm run dev:extension # Extension build in watch mode
```

## Build

```bash
# Build all packages
npm run build

# Or build individually
npm run build:backend
npm run build:extension
```

## Extension Setup

1. Build the extension: `npm run build:extension`
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `packages/extension/dist`

## Project Status

Current phase: **MVP+ - Platform-aware capture + resilient streaming**

- ✅ Monorepo structure
- 🔄 WebSocket communication + recovery
- 🔄 Audio capture (`mixed` + `per-track`)
- ✅ STT integration (Deepgram)
- ✅ Pachca + Google Meet per-track mode
- 🔄 Capability-based scaling (Zoom/Teams mixed mode)

## License

Private project
