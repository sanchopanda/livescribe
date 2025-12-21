// STT module - factory for creating STT providers

import type { STTProvider, STTProviderType } from './types.js';
import { VoskHTTPSTT } from './vosk-http.js';
import { DeepgramSTT } from './deepgram.js';

export function createSTTProvider(type: STTProviderType = 'vosk'): STTProvider {
  switch (type) {
    case 'vosk':
      return new VoskHTTPSTT();
    
    case 'deepgram':
      return new DeepgramSTT();
    
    default:
      throw new Error(`Unsupported STT provider type: ${type}`);
  }
}

export type { STTProvider, STTResult, STTProviderType } from './types.js';

