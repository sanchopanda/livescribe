// STT module - factory for creating STT providers

import type { STTProvider, STTProviderType } from './types.js';
import { DeepgramSTT } from './deepgram.js';

export function createSTTProvider(type: STTProviderType = 'deepgram'): STTProvider {
  switch (type) {
    case 'deepgram':
      return new DeepgramSTT();

    default:
      throw new Error(`Unsupported STT provider type: ${type}`);
  }
}

export type { STTProvider, STTResult, STTProviderType } from './types.js';
