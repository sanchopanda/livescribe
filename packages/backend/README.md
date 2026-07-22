# LiveScribe Backend

Node.js backend for LiveScribe Chrome extension.

## Environment Variables

### General
- `PORT` - server port (default: `3001`)
- `STT_PROVIDER` - STT provider (only `deepgram` is supported; default: `deepgram`)
- `DEEPGRAM_API_KEY` - required Deepgram API key
- `DEEPGRAM_MODEL` - Deepgram model (default: `nova-3`)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
PORT=3001
STT_PROVIDER=deepgram
DEEPGRAM_API_KEY=your_deepgram_api_key_here
```

3. Run development server:
```bash
npm run dev
```

## STT Provider

### Deepgram (Cloud)
- ✅ Real-time streaming with low latency
- ✅ Works with both `mixed` and `per-track` audio modes (a separate provider is created per participant track)
- ⚠️ Internet required
- ⚠️ Paid service
