# LiveScribe Backend

Node.js backend for LiveScribe Chrome extension.

## Environment Variables

### General
- `PORT` - Server port (default: 3001)
- `STT_PROVIDER` - STT provider type: `deepgram` or `vosk` (default: `vosk`)
- `DEEPGRAM_API_KEY` - Deepgram API key (required when `STT_PROVIDER=deepgram`)

### Yandex SpeechKit
- `YANDEX_SPEECHKIT_API_KEY` - Yandex Cloud API key (or use `YANDEX_IAM_TOKEN`)
- `YANDEX_IAM_TOKEN` - Yandex Cloud IAM token (alternative to API key)
- `YANDEX_FOLDER_ID` - Yandex Cloud Folder ID (required if using API key)

### Vosk (Python Service)
- `STT_SERVICE_URL` - Python STT service URL (default: `http://localhost:3002`)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file (Deepgram example):
```bash
PORT=3001
STT_PROVIDER=deepgram
DEEPGRAM_API_KEY=your_deepgram_api_key_here
```

3. Run development server:
```bash
npm run dev
```

## Getting Deepgram API Key

1. Go to [Deepgram Console](https://console.deepgram.com/)
2. Create or open your project
3. Generate an API key
4. Put it into backend `.env` as `DEEPGRAM_API_KEY`

## STT Providers

### Deepgram (Cloud)
- ✅ Streaming transcription with low latency
- ⚠️ Diarization/multi-speaker segmentation is currently disabled in runtime (archived for future)
- ❌ Requires internet
- ❌ Paid service (free tier/add-ons depend on account)

### Vosk (Local)
- ✅ Works offline
- ✅ Free
- ❌ Requires downloading models (~1.8 GB per language)
- ❌ Lower accuracy than cloud services

### Whisper (Local)
- ✅ Works offline
- ✅ Free
- ❌ Currently not working (library issue)
