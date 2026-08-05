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

export type ServerMessage =
  | StatusMessage
  | ErrorMessage
  | PartialTranscriptMessage
  | FinalTranscriptMessage;
