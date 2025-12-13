# LiveScribe Backend

WebSocket server for real-time audio transcription.

## STT Providers

The backend supports multiple STT (Speech-to-Text) providers through a modular architecture.

### Current Providers

- **Whisper** (default) - Using `@xenova/transformers`
  - Multilingual support
  - No native dependencies
  - Works out of the box

### Future Providers

- **Vosk** - Placeholder ready for implementation
  - See `src/stt/vosk.ts` for implementation template

## Configuration

Set STT provider via environment variable:

```bash
STT_PROVIDER=whisper  # or 'vosk' when implemented
```

Default: `whisper`

## Switching STT Providers

To switch providers, simply change the `STT_PROVIDER` environment variable. The system uses the `STTProvider` interface, so any provider implementing it can be used.

## Adding New STT Provider

1. Create new file in `src/stt/` (e.g., `myprovider.ts`)
2. Implement `STTProvider` interface from `src/stt/types.ts`
3. Add to factory in `src/stt/index.ts`
4. Set `STT_PROVIDER` environment variable

