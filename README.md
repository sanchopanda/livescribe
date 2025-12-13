# LiveScribe

Real-time transcription for video calls (Google Meet, Zoom, MS Teams).

## Architecture

Monorepo structure with pnpm workspaces:
- `packages/extension` - Chrome Extension (React + TypeScript)
- `packages/backend` - WebSocket server (Node.js + Fastify)
- `packages/shared` - Shared TypeScript types

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

Current phase: **MVP - Audio Capture + WebSocket**

- ✅ Monorepo structure
- 🔄 WebSocket communication
- 🔄 Audio capture (chrome.tabCapture)
- ⏳ STT integration (planned)
- ⏳ Platform support (Meet/Zoom/Teams)

## License

Private project
