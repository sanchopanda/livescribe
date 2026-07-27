# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Skribo (переименовано из «LiveScribe», см. `docs/decisions/0004-product-name-skribo.md`;
идентификаторы пакетов — `@skribo/*`, ребрендинг LS-10 завершён)
is a Chrome extension for real-time transcription of video calls (Google Meet, Zoom, MS Teams, Pachca). It supports platform-aware audio pipelines:
- **mixed** mode: classic tab audio capture via `chrome.tabCapture`
- **per-track** mode: per-participant WebRTC track capture (implemented for Pachca and Google Meet)

Audio is streamed over WebSocket to the Deepgram STT backend and rendered in-page in real time.

## Commands

```bash
# Install dependencies
npm install

# Development (runs backend + extension in watch mode)
npm run dev

# Run individually
npm run dev:backend    # Backend on ws://localhost:3001
npm run dev:extension  # Extension build in watch mode

# Build all packages
npm run build

# Type checking
npm run type-check

# Linting
npm run lint
```

### Loading the Extension in Chrome
1. Build: `npm run build:extension`
2. Navigate to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select `packages/extension/dist`

## Architecture

Monorepo using npm workspaces with three packages:

### packages/shared
TypeScript types shared between frontend and backend:
- `websocket-protocol.ts` - WebSocket message types (ClientMessage, ServerMessage)
- `audio-types.ts` - Audio configuration and chunk types

### packages/extension
Chrome Extension (Manifest V3) built with Vite + React + TypeScript:
- `src/popup/` - React popup UI
- `src/audio/encoder.ts` - Float32 → Int16 PCM conversion utilities
- `src/websocket/client.ts` - WebSocket client with auto-reconnect
- `src/content/platforms/` - platform-specific logic (Pachca/Teams, etc.)
- `src/content/platform/` - platform adapter + detection
- `src/platform/audio-mode-capabilities.ts` - centralized platform capabilities (per-track/mixed, speaker detection, WebRTC hook support)

Audio capture flow depends on platform/mode:
- **mixed**: `chrome.tabCapture` → AudioContext → AudioWorklet → PCM Int16 → base64 → WebSocket
- **per-track (Pachca, Meet)**: MAIN-world WebRTC hook → track registry → per-track AudioWorklet capture → PCM Int16 → base64 → WebSocket

**Content Scripts:** Currently limited to specific domains (Google Meet, Zoom, Teams, YouTube).
TODO: Update `public/manifest.json` matches list when adding support for new video platforms.

### packages/backend
Node.js WebSocket server using Fastify:
- `src/server.ts` - Fastify server setup with CORS and WebSocket plugin
- `src/websocket/handler.ts` - WebSocket message routing (start/audio/stop)
- `src/websocket/session.ts` - Session management and audio chunk logging
- `src/stt/` - STT provider interface and Deepgram streaming implementation

## WebSocket Protocol

Endpoint: `ws://localhost:3001/ws`

**Client → Server:**
- `{ type: "start", language: "ru-RU" | "en-US", platform?, audioMode? }` - Start session
- `{ type: "audio", sessionId, sampleRate: 16000, channels: 1, chunk: "<base64>" }` - Audio chunk
- `{ type: "stop", sessionId }` - Stop session

**Server → Client:**
- `{ type: "status", status: "connected" | "recording" | "idle", sessionId? }` - Status updates
- `{ type: "partial", text, timestamp, confidence? }` - Partial transcript
- `{ type: "final", text, timestamp, confidence, speaker? }` - Final transcript
- `{ type: "error", code, message }` - Errors

## Current Status

MVP+: Audio capture + WebSocket streaming is implemented, including platform-aware audio mode selection. STT integration:
- **Deepgram (Cloud)**: ✅ Implemented (streaming) — the only supported STT provider

Notes on speaker labeling:
- DOM speaker names (e.g. Pachca participant names) are still used as the primary user-visible names.
- Runtime speaker assignment is currently DOM-only.
- Experimental WebRTC and Deepgram diarization logic is archived in `docs/SPEAKER_DETECTION_ARCHIVE.md` for future restoration.

Platform audio modes:
- **Pachca, Meet**: `mixed` + `per-track` (switchable in widget)
- **Teams/Zoom**: `mixed` only for now (capability-gated in UI/runtime)

STT is Deepgram-only. Set `DEEPGRAM_API_KEY` in backend `.env` (see `packages/backend/.env.example`).

## Development Flow

Задачи, документация и релизы ведутся локально в репозитории. Подробные правила — в
[`docs/CONVENTIONS.md`](docs/CONVENTIONS.md).

### Принципы

1. **Дизайн до кода.** Новая фича проходит brainstorming → спека в `docs/superpowers/specs/`
   (или `docs/specs/NN-<feature>.md`) → согласование → реализация.
2. **Доки = зеркало реальности.** На каждой логической точке (завершённая задача, конец
   сессии) — прежде чем браться за новое — привести в актуальное состояние
   `docs/backlog.md` и `docs/PROGRESS.md`, а при изменении архитектуры/правил —
   `docs/KNOWLEDGE.md` и спеку/ADR. Истина статуса задачи = состояние git (коммит в `main`).
3. **Ответ до действия.** Сначала ответ по существу, потом предложение что-то сделать.

### Где что лежит

- [`docs/backlog.md`](docs/backlog.md) — задачи (`LS-NN`) по фазам.
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — курсор: сделано / следующее / в работе / блокеры.
- [`docs/KNOWLEDGE.md`](docs/KNOWLEDGE.md) — живые заметки (глоссарий, грабли).
- [`docs/decisions/`](docs/decisions/) — ADR; [`docs/specs/`](docs/specs/) — спеки фич.
- [`CHANGELOG.md`](CHANGELOG.md) — релиз-ноуты (Keep a Changelog).

### Скиллы (`.claude/skills/`)

- **`proceed`** — оркестратор: одна задача из бэклога через цикл реализация → тест →
  ревью → коммит. Триггеры: «продолжай / дальше / поехали / continue», `/proceed`.
- **`implement-task`** — реализация по стек-правилам livescribe (делегирует TDD).
- **`test-task`** — проверка: `type-check` + `build` + прогон поведения; вердикт PASS/FAIL.
- **`review-task`** — ревью диффа (`/code-review` + чек-лист правил репо).
- **`release`** — выпуск: `CHANGELOG` + тег `vX.Y.Z` + GitHub Release. Релиз ≠ деплой.

Коммитить/пушить — только когда попросил пользователь; коммит **прямо в `main`** (практика
репо), ветка — только для изоляции. Секреты/`.env`/`dist` не коммитить.
