# LiveScribe Backend

Node.js backend for LiveScribe Chrome extension.

## Environment Variables

### General
- `PORT` - server port (default: `3001`)
- `STT_PROVIDER` - `deepgram`, `vosk`, or `whisper` (default: `vosk`)
- `DEEPGRAM_API_KEY` - required when `STT_PROVIDER=deepgram`

### Python STT service (Vosk / Whisper)
- `STT_SERVICE_URL` - STT service URL (default: `http://127.0.0.1:3002`)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file (examples):
```bash
# Deepgram
PORT=3001
STT_PROVIDER=deepgram
DEEPGRAM_API_KEY=your_deepgram_api_key_here
```

```bash
# Whisper / Vosk via Python service
PORT=3001
STT_PROVIDER=whisper
STT_SERVICE_URL=http://127.0.0.1:3002
```

3. Run development server:
```bash
npm run dev
```

## STT Providers

### Deepgram (Cloud)
- ✅ Real-time streaming with low latency
- ⚠️ Internet required
- ⚠️ Paid service

### Vosk (Local via Python service)
- ✅ Offline
- ✅ Free
- ⚠️ Lower quality than cloud STT
- ⚠️ Requires local Vosk models

### Whisper (Local via Python service)
- ✅ Offline
- ✅ Better quality than Vosk in many cases
- ⚠️ Higher CPU/GPU usage than Vosk
- ⚠️ Higher latency than cloud streaming STT

## Notes for `per-track` + Whisper

- Backend creates a separate Whisper provider per participant track.
- Provider initialization is synchronized to avoid race conditions.
- For local STT use `STT_SERVICE_URL=http://127.0.0.1:3002` (IPv4), not `localhost` when local DNS/IPv6 causes issues.
