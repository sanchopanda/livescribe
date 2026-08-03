// STT Provider interface - allows easy switching between different STT engines

export interface STTResult {
  text: string;
  isFinal: boolean;
  confidence?: number;
  language?: string;
  speaker?: string;
  /**
   * Where this segment sits in the audio stream, in seconds from its start. Streaming results
   * arrive a second or three after the words were spoken, so this is what lets the caller
   * attribute a segment to whoever was speaking *then* rather than now.
   */
  startSec?: number;
  durationSec?: number;
}

export type STTResultCallback = (result: STTResult) => void;

export interface STTProvider {
  /**
   * Initialize the STT provider
   * @param language Language code (e.g., 'ru-RU', 'en-US')
   * @param onResult Optional callback for real-time transcription results (for streaming providers)
   */
  initialize(language: string, onResult?: STTResultCallback): Promise<void>;

  /**
   * Process audio chunk and return transcription
   * @param audioBuffer Audio data (PCM Int16 or OGG Opus, 16kHz, mono)
   * @param format Optional format hint: 'pcm' or 'ogg-opus'/'webm-opus'
   * @returns Transcription result (may be null if provider uses callback for async results)
   */
  processAudio(audioBuffer: Buffer, format?: string): Promise<STTResult | null>;

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

export type STTProviderType = 'deepgram';

