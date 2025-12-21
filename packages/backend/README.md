# LiveScribe Backend

Node.js backend for LiveScribe Chrome extension.

## Environment Variables

### General
- `PORT` - Server port (default: 3001)
- `STT_PROVIDER` - STT provider type: `whisper`, `vosk`, or `yandex` (default: `vosk`)

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

2. Create `.env` file:
```bash
PORT=3001
STT_PROVIDER=yandex
YANDEX_SPEECHKIT_API_KEY=your_api_key_here
YANDEX_FOLDER_ID=your_folder_id_here
```

3. Run development server:
```bash
npm run dev
```

## Getting Yandex SpeechKit Credentials

1. Go to [Yandex Cloud Console](https://console.cloud.yandex.ru/)
2. Create a folder or use existing one
3. Get Folder ID from folder settings
4. Create a service account or use your account
5. Get API key or IAM token:
   - **API Key**: Create in "Access keys" section
   - **IAM Token**: Use `yc iam create-token` command or get from console

## STT Providers

### Yandex SpeechKit (Cloud)
- ✅ No local models needed
- ✅ High accuracy
- ✅ Multiple languages
- ❌ Requires internet
- ❌ Paid service (free tier available)

### Vosk (Local)
- ✅ Works offline
- ✅ Free
- ❌ Requires downloading models (~1.8 GB per language)
- ❌ Lower accuracy than cloud services

### Whisper (Local)
- ✅ Works offline
- ✅ Free
- ❌ Currently not working (library issue)
