# Deepgram STT Setup

## Overview

Deepgram provides high-accuracy speech-to-text transcription with low latency. This implementation uses Deepgram's streaming API for real-time transcription.

## Prerequisites

1. **Deepgram Account**: Sign up at [https://deepgram.com](https://deepgram.com)
2. **API Key**: Get your API key from the Deepgram dashboard

## Configuration

Add to your `.env` file:

```env
DEEPGRAM_API_KEY=your_deepgram_api_key_here
STT_PROVIDER=deepgram
```

## Usage

The Deepgram STT provider is automatically used when `STT_PROVIDER=deepgram` is set in your environment variables.

## Supported Languages

Deepgram supports many languages. The implementation maps common language codes:
- `ru`, `ru-RU` → Russian
- `en`, `en-US`, `en-GB` → English
- `tr`, `tr-TR` → Turkish
- `es`, `es-ES` → Spanish
- `fr`, `fr-FR` → French
- `de`, `de-DE` → German
- `it`, `it-IT` → Italian
- `pt`, `pt-BR` → Portuguese
- `ja`, `ja-JP` → Japanese
- `ko`, `ko-KR` → Korean
- `zh`, `zh-CN` → Chinese

## Features

- **Streaming API**: Real-time transcription with low latency
- **Interim Results**: Partial transcripts while speaking
- **Smart Formatting**: Automatic punctuation and formatting
- **Model**: Uses `nova-2` model (latest and most accurate)
- **Diarization**: Enabled (`diarize: true`) for per-speaker word labeling
- **Speaker Segmentation**: Splits one Deepgram result into speaker-specific segments when speakers change inside a chunk
- **DOM Name Mapping**: `DG Speaker N` labels are mapped to DOM speaker history (e.g. Pachca participant names) when available

## Audio Format

- **Format**: PCM (Int16)
- **Sample Rate**: 16kHz
- **Channels**: Mono

## Speaker Label Priority

When backend sends transcript messages to the extension:

1. If Deepgram diarization provides speaker labels and they can be mapped to DOM history, mapped DOM names are used.
2. Otherwise current DOM speaker (`session.speaker`) is used as fallback.
3. If neither source is available, `speaker` may be omitted.

## Free Tier

Deepgram offers a free tier with:
- 12,000 minutes per month
- No credit card required
- Full API access

## Documentation

- [Deepgram Documentation](https://developers.deepgram.com/docs)
- [Node.js SDK](https://github.com/deepgram/deepgram-node-sdk)

