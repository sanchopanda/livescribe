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

/**
 * Статус связи провайдера с распознаванием (LS-04), наружу транслируется как
 * `stt_status` (см. `@skribo/shared` `SttStatusMessage`):
 *  - 'ok' — соединение открыто, распознавание идёт;
 *  - 'reconnecting' — соединение оборвалось, запланирована повторная попытка
 *    с растущей задержкой (см. `reconnect-backoff.ts`);
 *  - 'failed' — растущая фаза попыток (500..8000мс) исчерпана без успеха.
 *    НЕ терминально: реконнект продолжается с постоянным редким интервалом
 *    (30с), пока сессия жива, — если Deepgram отвалился надолго и вернулся,
 *    распознавание само возобновится, счётчик сбросится, статус вернётся
 *    к 'ok'. Полная остановка после серии неудач была регрессом (сессия не
 *    восстанавливалась сама на длинных обрывах), поэтому 'failed' здесь
 *    значит "давно не получается", а не "сдались".
 */
export type STTStatus = 'ok' | 'reconnecting' | 'failed';

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

  /**
   * Subscribe to connection-status changes (LS-04). Optional so providers that don't stream
   * (or don't reconnect) aren't forced to implement it. The callback fires only on transitions,
   * not on every underlying event — callers decide what "changed" means for their own aggregate.
   */
  onStatusChange?(cb: (status: STTStatus) => void): void;
}

export type STTProviderType = 'deepgram';

