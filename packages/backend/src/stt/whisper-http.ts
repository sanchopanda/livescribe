import type { STTProvider, STTResult, STTResultCallback } from './types.js';
import { randomUUID } from 'node:crypto';

const STT_SERVICE_URL = process.env.STT_SERVICE_URL || 'http://127.0.0.1:3002';

export class WhisperHTTPSTT implements STTProvider {
  private language = 'ru';
  private initialized = false;
  private readonly streamId = randomUUID();

  async initialize(language: string, _onResult?: STTResultCallback): Promise<void> {
    this.language = language;

    try {
      const response = await fetch(`${STT_SERVICE_URL}/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, engine: 'whisper', stream_id: this.streamId }),
      });

      if (!response.ok) {
        const errorBody: any = await response.json().catch(() => null);
        const detail = typeof errorBody?.detail === 'string' ? errorBody.detail : null;
        throw new Error(detail || `Failed to initialize Whisper service: ${response.statusText}`);
      }

      this.initialized = true;
    } catch (err) {
      throw new Error(`Whisper STT initialization failed: ${(err as Error).message}`);
    }
  }

  async processAudio(audioBuffer: Buffer, _format?: string): Promise<STTResult | null> {
    if (!this.initialized) {
      throw new Error('Whisper not initialized. Call initialize() first.');
    }

    try {
      const base64 = audioBuffer.toString('base64');

      const response = await fetch(`${STT_SERVICE_URL}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: this.language,
          chunk: base64,
          sample_rate: 16000,
          engine: 'whisper',
          stream_id: this.streamId,
        }),
      });

      if (!response.ok) {
        const errorBody: any = await response.json().catch(() => null);
        const detail = typeof errorBody?.detail === 'string' ? errorBody.detail : null;
        if (detail) {
          throw new Error(`Whisper process failed: ${detail}`);
        }
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
    } catch {
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
        body: JSON.stringify({ language: this.language, engine: 'whisper', stream_id: this.streamId }),
      });

      if (!response.ok) {
        const errorBody: any = await response.json().catch(() => null);
        const detail = typeof errorBody?.detail === 'string' ? errorBody.detail : null;
        if (detail) {
          throw new Error(`Whisper finalize failed: ${detail}`);
        }
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
    } catch {
      return null;
    }
  }

  async destroy(): Promise<void> {
    try {
      await fetch(`${STT_SERVICE_URL}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: this.language, engine: 'whisper', stream_id: this.streamId }),
      });
    } catch {
      // ignore cleanup errors
    }

    this.initialized = false;
  }
}
