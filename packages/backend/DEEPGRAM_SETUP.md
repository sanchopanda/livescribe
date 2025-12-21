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

## Audio Format

- **Format**: PCM (Int16)
- **Sample Rate**: 16kHz
- **Channels**: Mono

## Free Tier

Deepgram offers a free tier with:
- 12,000 minutes per month
- No credit card required
- Full API access

## Documentation

- [Deepgram Documentation](https://developers.deepgram.com/docs)
- [Node.js SDK](https://github.com/deepgram/deepgram-node-sdk)

