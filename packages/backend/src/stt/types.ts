// STT Provider interface - allows easy switching between different STT engines

export interface STTResult {
  text: string;
  isFinal: boolean;
  confidence?: number;
  language?: string;
}

export interface STTProvider {
  /**
   * Initialize the STT provider
   * @param language Language code (e.g., 'ru-RU', 'en-US')
   */
  initialize(language: string): Promise<void>;

  /**
   * Process audio chunk and return transcription
   * @param audioBuffer PCM audio data (Int16, 16kHz, mono)
   * @returns Transcription result
   */
  processAudio(audioBuffer: Buffer): Promise<STTResult | null>;

  /**
   * Finalize current sentence/segment
   * @returns Final transcription if available
   */
  finalize(): Promise<STTResult | null>;

  /**
   * Cleanup resources
   */
  destroy(): Promise<void>;
}

export type STTProviderType = 'whisper' | 'vosk' | 'openai' | 'deepgram';

