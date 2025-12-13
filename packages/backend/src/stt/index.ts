// STT module - factory for creating STT providers

import type { STTProvider, STTProviderType } from './types.js';
import { WhisperSTT } from './whisper.js';
import { VoskHTTPSTT } from './vosk-http.js';
// import { VoskSTT } from './vosk.js'; // Direct Node.js implementation (requires native deps)

export function createSTTProvider(type: STTProviderType = 'whisper'): STTProvider {
  switch (type) {
    case 'whisper':
      return new WhisperSTT();
    
    case 'vosk':
      // Use HTTP-based Vosk (Python service) instead of direct Node.js implementation
      return new VoskHTTPSTT();
    
    default:
      throw new Error(`Unsupported STT provider type: ${type}`);
  }
}

export type { STTProvider, STTResult, STTProviderType } from './types.js';

