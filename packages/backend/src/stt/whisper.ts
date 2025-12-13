// Whisper STT implementation using @xenova/transformers

import { pipeline, env } from '@xenova/transformers';
import type { STTProvider, STTResult } from './types.js';

// Disable local model files (use HuggingFace cache)
env.allowLocalModels = false;

export class WhisperSTT implements STTProvider {
  private model: any = null;
  private processor: any = null;
  private language: string = 'ru';
  private modelName: string = '';
  private initialized = false;
  private audioBuffer: Float32Array[] = [];
  private readonly sampleRate = 16000;
  private readonly chunkDuration = 2000; // Process every 2 seconds
  private lastProcessTime = 0;

  async initialize(language: string): Promise<void> {
    if (this.initialized && this.language === language) {
      return;
    }

    try {
      // Whisper uses language codes like 'ru', 'en', etc.
      // Extract language code from 'ru-RU' or 'en-US' format
      const langCode = language.split('-')[0].toLowerCase();
      this.language = langCode;

      console.log(`Initializing Whisper model for language: ${langCode}`);

      // Load Whisper model
      // Try different model identifiers that work with transformers.js
      // Note: Xenova models may not work, try OpenAI models instead
      this.modelName = langCode === 'en' 
        ? 'openai/whisper-tiny'
        : 'openai/whisper-tiny'; // Multilingual model

      console.log(`Loading Whisper model: ${this.modelName}`);

      // NOTE: transformers.js v2.17.2 has known issues with Whisper models
      // The pipeline API doesn't support Whisper models properly
      // Workaround: Use a mock implementation for now
      // TODO: Update to newer version of @xenova/transformers or use alternative library
      
      throw new Error(
        'Whisper STT is currently not supported due to transformers.js compatibility issues. ' +
        'Please use Vosk STT instead (when implemented) or update @xenova/transformers to a version that supports Whisper. ' +
        'For now, transcription will be disabled but audio will still be saved to files.'
      );

      // Original code (commented out until transformers.js supports Whisper):
      // this.processor = await pipeline(
      //   'automatic-speech-recognition',
      //   this.modelName,
      //   {
      //     device: 'cpu',
      //   }
      // );

      this.initialized = true;
      console.log('Whisper model loaded successfully');
    } catch (err) {
      console.error('Failed to initialize Whisper:', err);
      throw new Error(`Whisper initialization failed: ${(err as Error).message}`);
    }
  }

  async processAudio(audioBuffer: Buffer): Promise<STTResult | null> {
    if (!this.initialized || !this.processor) {
      throw new Error('Whisper not initialized. Call initialize() first.');
    }

    try {
      // Convert Int16 PCM to Float32 (-1.0 to 1.0)
      const int16Array = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.length / 2);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      // Accumulate audio chunks
      this.audioBuffer.push(float32Array);

      const now = Date.now();
      const timeSinceLastProcess = now - this.lastProcessTime;

      // Process every chunkDuration milliseconds
      if (timeSinceLastProcess >= this.chunkDuration) {
        // Combine accumulated chunks
        const totalLength = this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
        const combinedAudio = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of this.audioBuffer) {
          combinedAudio.set(chunk, offset);
          offset += chunk.length;
        }

        // Reset buffer
        this.audioBuffer = [];

        // Process with Whisper
        // For English-only models, don't specify language parameter
        const options: any = {
          return_timestamps: false,
          task: 'transcribe',
        };
        
        // Only add language for multilingual models (not .en models)
        if (!this.modelName.endsWith('.en') && this.language !== 'en') {
          options.language = this.language;
        }

        const result = await this.processor(combinedAudio, options);

        this.lastProcessTime = now;

        if (result && result.text && result.text.trim()) {
          return {
            text: result.text.trim(),
            isFinal: false, // Whisper processes in chunks, so this is partial
            confidence: result.chunks?.[0]?.score || undefined,
            language: this.language,
          };
        }
      }

      return null;
    } catch (err) {
      console.error('Whisper processing error:', err);
      return null;
    }
  }

  async finalize(): Promise<STTResult | null> {
    // Process any remaining audio
    if (this.audioBuffer.length > 0) {
      const totalLength = this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
      const combinedAudio = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of this.audioBuffer) {
        combinedAudio.set(chunk, offset);
        offset += chunk.length;
      }

      this.audioBuffer = [];

      try {
        const options: any = {
          return_timestamps: false,
          task: 'transcribe',
        };
        
        if (!this.modelName.endsWith('.en') && this.language !== 'en') {
          options.language = this.language;
        }

        const result = await this.processor(combinedAudio, options);

        if (result && result.text && result.text.trim()) {
          return {
            text: result.text.trim(),
            isFinal: true,
            confidence: result.chunks?.[0]?.score || undefined,
            language: this.language,
          };
        }
      } catch (err) {
        console.error('Whisper finalize error:', err);
      }
    }

    return null;
  }

  async destroy(): Promise<void> {
    this.processor = null;
    this.audioBuffer = [];
    this.initialized = false;
    console.log('Whisper resources cleaned up');
  }
}

