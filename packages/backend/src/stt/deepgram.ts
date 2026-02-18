// Deepgram STT implementation using @deepgram/sdk
// Documentation: https://developers.deepgram.com/docs

import type { STTProvider, STTResult, STTResultCallback } from './types.js';
import { createClient } from '@deepgram/sdk';

interface DeepgramWord {
  word?: string;
  confidence?: number;
  speaker?: number;
}

interface DeepgramSpeakerSegment {
  speaker?: string;
  text: string;
  confidence?: number;
}

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

  private formatSpeakerLabel(speakerId: number): string {
    return `DG Speaker ${speakerId + 1}`;
  }

  private splitBySpeaker(words: DeepgramWord[]): DeepgramSpeakerSegment[] {
    if (!Array.isArray(words) || words.length === 0) {
      return [];
    }

    const segments: DeepgramSpeakerSegment[] = [];
    let currentSpeakerId: number | undefined;
    let currentWords: string[] = [];
    let confidenceSum = 0;
    let confidenceCount = 0;

    const flush = () => {
      if (currentWords.length === 0) {
        return;
      }

      const text = currentWords.join(' ').trim();
      if (!text) {
        return;
      }

      segments.push({
        speaker: typeof currentSpeakerId === 'number' ? this.formatSpeakerLabel(currentSpeakerId) : undefined,
        text,
        confidence: confidenceCount > 0 ? confidenceSum / confidenceCount : undefined,
      });
    };

    for (const word of words) {
      const token = (word.word || '').trim();
      if (!token) {
        continue;
      }

      const wordSpeaker = typeof word.speaker === 'number' ? word.speaker : undefined;
      if (currentWords.length > 0 && wordSpeaker !== currentSpeakerId) {
        flush();
        currentWords = [];
        confidenceSum = 0;
        confidenceCount = 0;
      }

      currentSpeakerId = wordSpeaker;
      currentWords.push(token);

      if (typeof word.confidence === 'number') {
        confidenceSum += word.confidence;
        confidenceCount += 1;
      }
    }

    flush();
    return segments;
  }

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

      // console.log(`Initializing Deepgram STT for language: ${langCode}`);
      // console.log(`Deepgram callback ${this.onResultCallback ? 'is set' : 'is NOT set'}`);

      this.deepgramClient = createClient(apiKey);

      const connection = this.deepgramClient.listen.live({
        model: 'nova-2',
        language: langCode,
        smart_format: true,
        punctuate: true,
        interim_results: true,
        endpointing: 300,
        diarize: true,
        sample_rate: 16000,
        channels: 1,
        encoding: 'linear16',
      });
      
      // console.log('Deepgram connection created with config:', {
        model: 'nova-2',
        language: langCode,
        diarize: true,
        sample_rate: 16000,
        channels: 1,
        encoding: 'linear16',
      // });

      this.connection = connection;

      // Log connection object structure for debugging
      // console.log('Deepgram connection object keys:', Object.keys(connection));
      // console.log('Deepgram connection methods:', Object.getOwnPropertyNames(connection).filter(name => typeof (connection as any)[name] === 'function'));

      connection.on('open', () => {
        // console.log('Deepgram connection opened - ready to receive audio');
        this.connectionOpen = true;
      });

      connection.on('error', (_error: Error) => {
        // console.error('Deepgram connection error:', error);
        // console.error('Deepgram error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      });

      connection.on('warning', (_warning: string) => {
        // console.warn('Deepgram warning:', warning);
      });

      connection.on('metadata', (_metadata: any) => {
        // console.log('Deepgram metadata received:', JSON.stringify(metadata, null, 2));
      });

      const processResults = (data: any) => {
        try {
          const payload = typeof data === 'string' ? JSON.parse(data) : data;

          // Deepgram payload shape can differ by SDK/event.
          // Accept canonical Results and payloads that already contain `channel`.
          if (!payload || (payload.type && payload.type !== 'Results' && !payload.channel)) {
            return;
          }

          const alternative = payload.channel?.alternatives?.[0];
          const transcript = alternative?.transcript || '';
          const isFinal = payload.is_final === true;
          const confidence = alternative?.confidence;
          const words: DeepgramWord[] = alternative?.words || [];

          if (words.length > 0) {
            console.log('Deepgram raw result:', JSON.stringify(payload));
          }

          if (transcript && transcript.trim()) {
            const defaultResult: STTResult = {
              text: transcript.trim(),
              isFinal,
              confidence,
              language: langCode,
            };

            const speakerSegments = this.splitBySpeaker(words);

            if (isFinal) {
              this.finalResults.push(defaultResult);
            } else {
              this.partialResults.push(defaultResult);
            }

            if (this.onResultCallback) {
              if (speakerSegments.length > 1) {
                for (const segment of speakerSegments) {
                  const segmentResult: STTResult = {
                    text: segment.text,
                    isFinal,
                    confidence: segment.confidence ?? confidence,
                    language: langCode,
                    speaker: segment.speaker,
                  };

                  if (words.length > 0) {
                    console.log(
                      `Deepgram ${isFinal ? 'final' : 'partial'} diarized: [${segmentResult.speaker || 'unknown'}] "${segmentResult.text}"`
                    );
                  }
                  this.onResultCallback(segmentResult);
                }
              } else {
                const segment = speakerSegments[0];
                const result: STTResult = {
                  ...defaultResult,
                  speaker: segment?.speaker,
                };

                if (words.length > 0) {
                  console.log(`Deepgram ${isFinal ? 'final' : 'partial'} transcript: "${result.text}" (confidence: ${result.confidence})`);
                }
                this.onResultCallback(result);
              }
            }
          } else if (words.length > 0) {
            console.log(`Deepgram received results with ${words.length} words but empty transcript (isFinal: ${isFinal})`);
          }
        } catch {
          // console.error('Error processing Deepgram results:', err);
        }
      };

      connection.on('Results', processResults);
      connection.on('results', processResults);
      connection.on('transcript', processResults);
      connection.on('message', (data: any) => {
        processResults(data);
      });

      connection.on('close', () => {
        // console.log('Deepgram connection closed');
        // console.log(`Total partial results: ${this.partialResults.length}, final results: ${this.finalResults.length}`);
        this.connectionOpen = false;
      });

      this.initialized = true;
      // console.log('Deepgram STT initialized successfully');
    } catch (err) {
      // console.error('Failed to initialize Deepgram:', err);
      throw new Error(`Deepgram initialization failed: ${(err as Error).message}`);
    }
  }

  async processAudio(audioBuffer: Buffer, format?: string): Promise<STTResult | null> {
    if (!this.initialized || !this.connection) {
      throw new Error('Deepgram not initialized. Call initialize() first.');
    }

    if (!this.connectionOpen) {
      // console.warn('Deepgram connection not yet open, buffering audio chunk');
      this.audioBuffer.push(audioBuffer);
      return null;
    }

    try {
      if (format === 'pcm' || !format) {
        this.audioBuffer.push(audioBuffer);
        // console.log(`Deepgram: Sending PCM audio chunk: ${audioBuffer.length} bytes, connection open: ${this.connectionOpen}`);
        
        // Send as Uint8Array (Deepgram SDK expects this format)
        const uint8Array = new Uint8Array(audioBuffer);
        this.connection.send(uint8Array);
      } else {
        // console.warn(`Deepgram: Unsupported format ${format}, expected PCM. Converting may be needed.`);
        this.audioBuffer.push(audioBuffer);
        // console.log(`Deepgram: Sending audio chunk (${format}): ${audioBuffer.length} bytes`);
        const uint8Array = new Uint8Array(audioBuffer);
        this.connection.send(uint8Array);
      }

      if (this.onResultCallback) {
        return null;
      }

      const latestPartial = this.partialResults[this.partialResults.length - 1] || null;
      const latestFinal = this.finalResults[this.finalResults.length - 1] || null;

      return latestFinal || latestPartial;
    } catch {
      // console.error('Deepgram processing error:', err);
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
    this.initialized = false;
    // console.log('Deepgram resources cleaned up');
  }
}

