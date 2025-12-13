// Client → Server messages

export interface AudioChunkMessage {
  type: 'audio';
  sessionId: string;
  sampleRate: 16000;
  channels: 1;
  chunk: string; // base64 encoded PCM Int16
}

export interface StartSessionMessage {
  type: 'start';
  language: 'ru-RU' | 'en-US';
  platform?: 'meet' | 'zoom' | 'teams';
}

export interface StopSessionMessage {
  type: 'stop';
  sessionId: string;
}

export type ClientMessage = AudioChunkMessage | StartSessionMessage | StopSessionMessage;

// Server → Client messages

export interface StatusMessage {
  type: 'status';
  status: 'connected' | 'recording' | 'processing' | 'idle';
  sessionId?: string;
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export interface PartialTranscriptMessage {
  type: 'partial';
  text: string;
  timestamp: number;
  confidence?: number;
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
