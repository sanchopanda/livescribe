// Vosk STT implementation via HTTP API (Python service)
// This allows using Python Vosk without native Node.js dependencies

import type { STTProvider, STTResult, STTResultCallback } from './types.js';

const STT_SERVICE_URL = process.env.STT_SERVICE_URL || 'http://localhost:3002';

export class VoskHTTPSTT implements STTProvider {
  private language: string = 'ru';
  private initialized = false;

  async initialize(language: string, _onResult?: STTResultCallback): Promise<void> {
    this.language = language;

    try {
      const response = await fetch(`${STT_SERVICE_URL}/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language }),
      });

      if (!response.ok) {
        const errorBody: any = await response.json().catch(() => null);
        const detail = typeof errorBody?.detail === 'string' ? errorBody.detail : null;
        throw new Error(detail || `Failed to initialize STT service: ${response.statusText}`);
      }

      this.initialized = true;
      console.log(`Vosk STT initialized for language: ${language}`);
    } catch (err) {
      console.error('Failed to initialize Vosk STT service:', err);
      throw new Error(`Vosk STT initialization failed: ${(err as Error).message}`);
    }
  }

  async processAudio(audioBuffer: Buffer, _format?: string): Promise<STTResult | null> {
    // Vosk works with PCM only
    if (!this.initialized) {
      throw new Error('Vosk not initialized. Call initialize() first.');
    }

    try {
      // Convert buffer to base64
      const base64 = audioBuffer.toString('base64');

      const response = await fetch(`${STT_SERVICE_URL}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: this.language,
          chunk: base64,
          sample_rate: 16000,
        }),
      });

      if (!response.ok) {
        const errorBody: any = await response.json().catch(() => null);
        console.error('STT processing error:', errorBody);
        return null;
      }

      const result: any = await response.json();

      if (typeof result?.text === 'string' && result.text.trim()) {
        return {
          text: result.text.trim(),
          isFinal: Boolean(result.is_final),
          confidence: typeof result.confidence === 'number' ? result.confidence : undefined,
          language: this.language,
        };
      }

      return null;
    } catch (err) {
      console.error('Vosk HTTP request error:', err);
      return null;
    }
  }

  async finalize(): Promise<STTResult | null> {
    if (!this.initialized) {
      return null;
    }

    try {
      const response = await fetch(`${STT_SERVICE_URL}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: this.language }),
      });

      if (!response.ok) {
        return null;
      }

      const result: any = await response.json();

      if (typeof result?.text === 'string' && result.text.trim()) {
        return {
          text: result.text.trim(),
          isFinal: true,
          confidence: typeof result.confidence === 'number' ? result.confidence : undefined,
          language: this.language,
        };
      }

      return null;
    } catch (err) {
      console.error('Vosk finalize error:', err);
      return null;
    }
  }

  async destroy(): Promise<void> {
    // Reset recognizer on Python service
    try {
      await fetch(`${STT_SERVICE_URL}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: this.language }),
      });
    } catch (err) {
      // Ignore errors on cleanup
    }

    this.initialized = false;
    console.log('Vosk HTTP STT resources cleaned up');
  }
}

