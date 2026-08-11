// Client → Server messages

export interface AudioChunkMessage {
  type: 'audio';
  sessionId: string;
  sampleRate: 16000;
  channels: 1;
  chunk: string; // base64 encoded PCM Int16
  participantId?: string;
  speaker?: string | null;
}

export interface SpeakerUpdateMessage {
  type: 'speaker';
  sessionId: string;
  speaker: string | null;
  participantId?: string;
  timestamp?: number;
}

/**
 * A per-track speaker was identified after the fact. Everything already recorded under the
 * placeholder label belongs to this participant too, so the server relabels it — otherwise the
 * opening minute of every call stays anonymous.
 */
export interface RenameParticipantMessage {
  type: 'rename_participant';
  sessionId: string;
  participantId: string;
  speaker: string;
}

export interface StartSessionMessage {
  type: 'start';
  language: 'ru-RU' | 'en-US';
  platform?: 'meet' | 'zoom' | 'teams' | 'pachca';
  audioMode?: 'per-track' | 'mixed';
  token?: string;
  /**
   * Continue the transcript of a meeting already in progress instead of opening a new one.
   * Set when a dropped WebSocket is being re-established: one call must stay one entry in
   * the cabinet, however many times the socket reconnects.
   */
  resumeMeetingId?: string;
}

export interface StopSessionMessage {
  type: 'stop';
  sessionId: string;
}

export type ClientMessage =
  | AudioChunkMessage
  | SpeakerUpdateMessage
  | RenameParticipantMessage
  | StartSessionMessage
  | StopSessionMessage;

// Server → Client messages

export interface StatusMessage {
  type: 'status';
  status: 'connected' | 'recording' | 'processing' | 'idle';
  sessionId?: string;
  /** Meeting this session persists into, so a reconnect can ask to resume it. */
  meetingId?: string;
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

/**
 * The token this device presented is not valid any more (revoked, or issued to an account that
 * no longer has it). Transcription keeps running, but nothing is being saved — the client must
 * say so and re-authenticate rather than record into nowhere.
 */
export const AUTH_INVALID_TOKEN = 'AUTH_INVALID_TOKEN';

export interface PartialTranscriptMessage {
  type: 'partial';
  text: string;
  timestamp: number;
  confidence?: number;
  speaker?: string;
}

export interface FinalTranscriptMessage {
  type: 'final';
  text: string;
  timestamp: number;
  confidence: number;
  speaker?: string;
}

/**
 * Статус связи бэкенда с STT-провайдером (LS-04). Это НЕ про запись — аудио
 * пишется независимо от этого статуса и продолжает писаться даже в 'failed'.
 * Смысл для клиента:
 *  - 'ok' — распознавание идёт, текст должен появляться как обычно;
 *  - 'reconnecting' — связь с распознаванием временно потеряна, идёт
 *    переподключение с растущей задержкой; текст может не появляться
 *    некоторое время — это ожидаемо, ждать, а не считать сессию мёртвой;
 *  - 'failed' — быстрые попытки переподключения (растущая задержка) не
 *    помогли, но это НЕ конец: попытки продолжаются в фоне с постоянным
 *    редким интервалом, пока сессия жива, и статус сам вернётся к 'ok', как
 *    только Deepgram снова станет доступен — никакой отдельной повторной
 *    обработки для этого не нужно и не существует. Аудио всё это время
 *    пишется как обычно — встреча НЕ потеряна, просто live-текста по ней
 *    сейчас нет. Повод показать предупреждение, а не прервать запись со
 *    стороны клиента.
 */
export interface SttStatusMessage {
  type: 'stt_status';
  state: 'ok' | 'reconnecting' | 'failed';
}

/** Relabelling done: the client rewrites the replicas it already displayed. */
export interface ParticipantRenamedMessage {
  type: 'participant_renamed';
  participantId: string;
  speaker: string;
  previousSpeaker: string;
}

export type ServerMessage =
  | StatusMessage
  | ErrorMessage
  | PartialTranscriptMessage
  | FinalTranscriptMessage
  | SttStatusMessage
  | ParticipantRenamedMessage;
