// Deepgram STT implementation using @deepgram/sdk
// Documentation: https://developers.deepgram.com/docs

import type { STTProvider, STTResult, STTResultCallback } from './types.js';
import { createClient } from '@deepgram/sdk';

export class DeepgramSTT implements STTProvider {
  private language: string = 'ru';
  private initialized = false;
  private deepgramClient: ReturnType<typeof createClient> | null = null;
  private connection: any = null;
  private onResultCallback: STTResultCallback | null = null;
  private partialResults: STTResult[] = [];
  private finalResults: STTResult[] = [];
  private audioBuffer: Buffer[] = [];
  private connectionOpen: boolean = false;

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
      'ru-RU': 'ru',
      'en': 'en',
      'en-US': 'en',
      'en-GB': 'en',
      'tr': 'tr',
      'tr-TR': 'tr',
      'es': 'es',
      'es-ES': 'es',
      'fr': 'fr',
      'fr-FR': 'fr',
      'de': 'de',
      'de-DE': 'de',
      'it': 'it',
      'it-IT': 'it',
      'pt': 'pt',
      'pt-BR': 'pt',
      'ja': 'ja',
      'ja-JP': 'ja',
      'ko': 'ko',
      'ko-KR': 'ko',
      'zh': 'zh',
      'zh-CN': 'zh',
    };

    const lang = language.toLowerCase();
    return langMap[lang] || 'en';
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
      const langCode = this.getLanguageCode(language);
      const apiKey = this.getApiKey();

      console.log(`Initializing Deepgram STT for language: ${langCode}`);
      console.log(`Deepgram callback ${this.onResultCallback ? 'is set' : 'is NOT set'}`);

      this.deepgramClient = createClient(apiKey);

      const connection = this.deepgramClient.listen.live({
        model: 'nova-2',
        language: langCode,
        smart_format: true,
        punctuate: true,
        interim_results: true,
        endpointing: 300,
        sample_rate: 16000,
        channels: 1,
        encoding: 'linear16',
      });
      
      console.log('Deepgram connection created with config:', {
        model: 'nova-2',
        language: langCode,
        sample_rate: 16000,
        channels: 1,
        encoding: 'linear16',
      });

      this.connection = connection;

      // Log connection object structure for debugging
      console.log('Deepgram connection object keys:', Object.keys(connection));
      console.log('Deepgram connection methods:', Object.getOwnPropertyNames(connection).filter(name => typeof (connection as any)[name] === 'function'));

      connection.on('open', () => {
        console.log('Deepgram connection opened - ready to receive audio');
        this.connectionOpen = true;
      });

      connection.on('error', (error: Error) => {
        console.error('Deepgram connection error:', error);
        console.error('Deepgram error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      });

      connection.on('warning', (warning: string) => {
        console.warn('Deepgram warning:', warning);
      });

      connection.on('metadata', (metadata: any) => {
        console.log('Deepgram metadata received:', JSON.stringify(metadata, null, 2));
      });

      const processResults = (data: any) => {
        try {
          if (data.type !== 'Results') {
            return;
          }

          const transcript = data.channel?.alternatives?.[0]?.transcript || '';
          const isFinal = data.is_final === true;
          const confidence = data.channel?.alternatives?.[0]?.confidence;
          const words = data.channel?.alternatives?.[0]?.words || [];

          if (transcript && transcript.trim()) {
            const result: STTResult = {
              text: transcript.trim(),
              isFinal,
              confidence,
              language: langCode,
            };

            if (isFinal) {
              this.finalResults.push(result);
            } else {
              this.partialResults.push(result);
            }

            if (this.onResultCallback) {
              console.log(`Deepgram ${isFinal ? 'final' : 'partial'} transcript: "${transcript.trim()}" (confidence: ${confidence})`);
              this.onResultCallback(result);
            }
          } else if (words.length > 0) {
            console.log(`Deepgram received results with ${words.length} words but empty transcript (isFinal: ${isFinal})`);
          }
        } catch (err) {
          console.error('Error processing Deepgram results:', err);
        }
      };

      connection.on('Results', processResults);
      connection.on('results', processResults);
      connection.on('transcript', processResults);
      connection.on('message', (data: any) => {
        if (data.type === 'Results') {
          processResults(data);
        }
      });

      connection.on('close', () => {
        console.log('Deepgram connection closed');
        console.log(`Total partial results: ${this.partialResults.length}, final results: ${this.finalResults.length}`);
        this.connectionOpen = false;
      });

      this.initialized = true;
      console.log('Deepgram STT initialized successfully');
    } catch (err) {
      console.error('Failed to initialize Deepgram:', err);
      throw new Error(`Deepgram initialization failed: ${(err as Error).message}`);
    }
  }

  async processAudio(audioBuffer: Buffer, format?: string): Promise<STTResult | null> {
    if (!this.initialized || !this.connection) {
      throw new Error('Deepgram not initialized. Call initialize() first.');
    }

    if (!this.connectionOpen) {
      console.warn('Deepgram connection not yet open, buffering audio chunk');
      this.audioBuffer.push(audioBuffer);
      return null;
    }

    try {
      if (format === 'pcm' || !format) {
        this.audioBuffer.push(audioBuffer);
        console.log(`Deepgram: Sending PCM audio chunk: ${audioBuffer.length} bytes, connection open: ${this.connectionOpen}`);
        
        // Send as Uint8Array (Deepgram SDK expects this format)
        const uint8Array = new Uint8Array(audioBuffer);
        this.connection.send(uint8Array);
      } else {
        console.warn(`Deepgram: Unsupported format ${format}, expected PCM. Converting may be needed.`);
        this.audioBuffer.push(audioBuffer);
        console.log(`Deepgram: Sending audio chunk (${format}): ${audioBuffer.length} bytes`);
        const uint8Array = new Uint8Array(audioBuffer);
        this.connection.send(uint8Array);
      }

      if (this.onResultCallback) {
        return null;
      }

      const latestPartial = this.partialResults[this.partialResults.length - 1] || null;
      const latestFinal = this.finalResults[this.finalResults.length - 1] || null;

      return latestFinal || latestPartial;
    } catch (err) {
      console.error('Deepgram processing error:', err);
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
    } catch (err) {
      console.error('Deepgram finalize error:', err);
      return null;
    }
  }

  async destroy(): Promise<void> {
    if (this.connection) {
      try {
        this.connection.finish();
      } catch (err) {
        console.error('Error closing Deepgram connection:', err);
      }
      this.connection = null;
    }

    this.deepgramClient = null;
    this.onResultCallback = null;
    this.partialResults = [];
    this.finalResults = [];
    this.audioBuffer = [];
    this.connectionOpen = false;
    this.initialized = false;
    console.log('Deepgram resources cleaned up');
  }
}

