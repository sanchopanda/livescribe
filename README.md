# LiveScribe

Real-time transcription for video calls (Google Meet, Zoom, MS Teams, Pachca).

## Architecture

Monorepo structure with pnpm workspaces:
- `packages/extension` - Chrome Extension (React + TypeScript)
- `packages/backend` - WebSocket server (Node.js + Fastify)
- `packages/shared` - Shared TypeScript types

### Platform-aware audio modes

- `mixed` mode: capture full tab audio via `chrome.tabCapture`.
- `per-track` mode: capture separate participant WebRTC tracks (currently Pachca).

Mode availability is capability-driven per platform in
`packages/extension/src/platform/audio-mode-capabilities.ts`.

`start` WebSocket payload now includes optional `platform` and `audioMode`.

## Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0

## Installation

```bash
# Install dependencies
npm install
```

## Development

```bash
# Run both backend and extension in watch mode
npm run dev

# Or run separately:
npm run dev:backend   # Backend on ws://localhost:3001
npm run dev:extension # Extension build in watch mode
```

## Build

```bash
# Build all packages
npm run build

# Or build individually:
npm run build:backend
npm run build:extension
```

## Extension Setup

1. Build the extension: `npm run build:extension`
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select `packages/extension/dist` folder

## Project Status

Current phase: **MVP+ - Platform-aware capture + WebSocket**

- ✅ Monorepo structure
- 🔄 WebSocket communication
- 🔄 Audio capture (chrome.tabCapture)
- ✅ STT integration (Deepgram + Vosk)
- ✅ Pachca per-track capture mode
- 🔄 Capability-based platform scaling (Meet/Zoom/Teams mixed mode)

## License

Private project
