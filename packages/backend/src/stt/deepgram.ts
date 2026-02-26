// Deepgram STT implementation using @deepgram/sdk
// Documentation: https://developers.deepgram.com/docs

import type { STTProvider, STTResult, STTResultCallback } from './types.js';
import { createClient } from '@deepgram/sdk';

export class DeepgramSTT implements STTProvider {
  private language: string = 'ru';
  private initialized = false;
  private reconnectInProgress = false;

  private deepgramClient: ReturnType<typeof createClient> | null = null;
  private connection: any = null;
  private onResultCallback: STTResultCallback | null = null;
  private partialResults: STTResult[] = [];
  private finalResults: STTResult[] = [];
  private audioBuffer: Buffer[] = [];
  private connectionOpen: boolean = false;
  private langCode: string = 'en';
  private deepgramModel: string = 'nova-3';
  private static readonly MAX_BUFFERED_CHUNKS = 400;

  private getApiKey(): string {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPGRAM_API_KEY environment variable is not set');
    }
    return apiKey;
  }

  private getLanguageCode(language: string): string {
    const langMap: Record<string, string> = {
      'ru': 'ru',
      'ru-ru': 'ru',
      'en': 'en',
      'en-us': 'en',
      'en-gb': 'en',
      'tr': 'tr',
      'tr-tr': 'tr',
      'es': 'es',
      'es-es': 'es',
      'fr': 'fr',
      'fr-fr': 'fr',
      'de': 'de',
      'de-de': 'de',
      'it': 'it',
      'it-it': 'it',
      'pt': 'pt',
      'pt-br': 'pt',
      'ja': 'ja',
      'ja-jp': 'ja',
      'ko': 'ko',
      'ko-kr': 'ko',
      'zh': 'zh',
      'zh-cn': 'zh',
    };

    const lang = language.toLowerCase();
    return langMap[lang] || 'en';
  }

  private getModel(): string {
    const model = process.env.DEEPGRAM_MODEL?.trim();
    return model || 'nova-3';
  }

  async initialize(language: string, onResult?: STTResultCallback): Promise<void> {
    if (this.initialized && this.language === language) {
      if (onResult) {
        this.onResultCallback = onResult;
      }
      return;
    }

    try {
      this.language = language;
      this.onResultCallback = onResult || null;
      this.langCode = this.getLanguageCode(language);
      this.deepgramModel = this.getModel();
      const apiKey = this.getApiKey();

      // console.log(`Initializing Deepgram STT for language: ${langCode}`);
      // console.log(`Deepgram callback ${this.onResultCallback ? 'is set' : 'is NOT set'}`);

      this.deepgramClient = createClient(apiKey);
      this.createConnection();

      this.initialized = true;
      // console.log('Deepgram STT initialized successfully');
    } catch (err) {
      // console.error('Failed to initialize Deepgram:', err);
      throw new Error(`Deepgram initialization failed: ${(err as Error).message}`);
    }
  }

  private createConnection(): void {
    if (!this.deepgramClient) {
      throw new Error('Deepgram client is not initialized');
    }

    const connection = this.deepgramClient.listen.live({
      model: this.deepgramModel,
      language: this.langCode,
      smart_format: true,
      punctuate: true,
      interim_results: true,
      endpointing: 300,
      diarize: false,
      sample_rate: 16000,
      channels: 1,
      encoding: 'linear16',
    });

    this.connection = connection;
    this.connectionOpen = false;

    connection.on('open', () => {
      this.connectionOpen = true;
      this.reconnectInProgress = false;
      this.flushBufferedAudio();
    });

    connection.on('error', () => {
      this.connectionOpen = false;
    });

    connection.on('warning', () => {
      // ignore warning
    });

    connection.on('metadata', () => {
      // ignore metadata
    });

    const processResults = (data: any) => {
      try {
        const payload = typeof data === 'string' ? JSON.parse(data) : data;

        if (!payload || (payload.type && payload.type !== 'Results' && !payload.channel)) {
          return;
        }

        const alternative = payload.channel?.alternatives?.[0];
        const transcript = alternative?.transcript || '';
        const isFinal = payload.is_final === true;
        const confidence = alternative?.confidence;

        if (transcript && transcript.trim()) {
          const defaultResult: STTResult = {
            text: transcript.trim(),
            isFinal,
            confidence,
            language: this.langCode,
          };

          if (isFinal) {
            this.finalResults.push(defaultResult);
          } else {
            this.partialResults.push(defaultResult);
          }

          if (this.onResultCallback) {
            this.onResultCallback(defaultResult);
          }
        }
      } catch {
        // ignore parse/result errors
      }
    };

    connection.on('Results', processResults);
    connection.on('results', processResults);
    connection.on('transcript', processResults);
    connection.on('message', (data: any) => {
      processResults(data);
    });

    connection.on('close', () => {
      this.connectionOpen = false;
    });
  }

  private flushBufferedAudio(): void {
    if (!this.connection || !this.connectionOpen || this.audioBuffer.length === 0) {
      return;
    }

    const buffered = this.audioBuffer.splice(0, this.audioBuffer.length);
    for (const chunk of buffered) {
      try {
        this.connection.send(new Uint8Array(chunk));
      } catch {
        this.audioBuffer.unshift(chunk);
        break;
      }
    }
  }

  private queueAudioChunk(chunk: Buffer): void {
    this.audioBuffer.push(chunk);
    if (this.audioBuffer.length > DeepgramSTT.MAX_BUFFERED_CHUNKS) {
      this.audioBuffer.splice(0, this.audioBuffer.length - DeepgramSTT.MAX_BUFFERED_CHUNKS);
    }
  }

  private tryReconnect(): void {
    if (!this.initialized || !this.deepgramClient || this.reconnectInProgress) {
      return;
    }

    this.reconnectInProgress = true;

    try {
      this.connection?.finish?.();
    } catch {
      // ignore finish errors
    }

    try {
      this.createConnection();
    } catch {
      this.reconnectInProgress = false;
    }
  }

  async processAudio(audioBuffer: Buffer, format?: string): Promise<STTResult | null> {
    if (!this.initialized || !this.connection) {
      throw new Error('Deepgram not initialized. Call initialize() first.');
    }

    this.queueAudioChunk(audioBuffer);

    if (!this.connectionOpen) {
      this.tryReconnect();
      return null;
    }

    try {
      if (format === 'pcm' || !format) {
        this.flushBufferedAudio();
      } else {
        this.flushBufferedAudio();
      }

      if (this.onResultCallback) {
        return null;
      }

      const latestPartial = this.partialResults[this.partialResults.length - 1] || null;
      const latestFinal = this.finalResults[this.finalResults.length - 1] || null;

      return latestFinal || latestPartial;
    } catch {
      this.connectionOpen = false;
      this.tryReconnect();
      return null;
    }
  }

  async finalize(): Promise<STTResult | null> {
    if (!this.connection) {
      return null;
    }

    try {
      this.connection.finish();

      const latestFinal = this.finalResults[this.finalResults.length - 1] || null;
      const latestPartial = this.partialResults[this.partialResults.length - 1] || null;

      return latestFinal || latestPartial;
    } catch {
      // console.error('Deepgram finalize error:', err);
      return null;
    }
  }

  async destroy(): Promise<void> {
    if (this.connection) {
      try {
        this.connection.finish();
      } catch {
        // console.error('Error closing Deepgram connection:', err);
      }
      this.connection = null;
    }

    this.deepgramClient = null;
    this.onResultCallback = null;
    this.partialResults = [];
    this.finalResults = [];
    this.audioBuffer = [];
    this.connectionOpen = false;
    this.reconnectInProgress = false;
    this.initialized = false;
    // console.log('Deepgram resources cleaned up');
  }
}

