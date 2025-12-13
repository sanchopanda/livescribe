# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LiveScribe is a Chrome extension for real-time transcription of video calls (Google Meet, Zoom, MS Teams). It captures tab audio via Chrome's tabCapture API, streams it over WebSocket to a backend, and displays transcriptions in real-time.

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

Audio capture flow: chrome.tabCapture → AudioContext → AudioWorklet → PCM Int16 → base64 → WebSocket

### packages/backend
Node.js WebSocket server using Fastify:
- `src/server.ts` - Fastify server setup with CORS and WebSocket plugin
- `src/websocket/handler.ts` - WebSocket message routing (start/audio/stop)
- `src/websocket/session.ts` - Session management and audio chunk logging

## WebSocket Protocol

Endpoint: `ws://localhost:3001/ws`

**Client → Server:**
- `{ type: "start", language: "ru-RU" | "en-US" }` - Start session
- `{ type: "audio", sessionId, sampleRate: 16000, channels: 1, chunk: "<base64>" }` - Audio chunk
- `{ type: "stop", sessionId }` - Stop session

**Server → Client:**
- `{ type: "status", status: "connected" | "recording" | "idle", sessionId? }` - Status updates
- `{ type: "partial", text, timestamp, confidence? }` - Partial transcript
- `{ type: "final", text, timestamp, confidence, speaker? }` - Final transcript
- `{ type: "error", code, message }` - Errors

## Current Status

MVP phase: Audio capture + WebSocket streaming is implemented. STT integration is pending.
