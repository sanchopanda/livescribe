export interface AudioConfig {
  sampleRate: 16000 | 44100 | 48000;
  channels: 1 | 2;
  bitDepth: 16 | 32;
}

export interface AudioChunk {
  data: ArrayBuffer;
  timestamp: number;
  duration: number;
}

export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  sampleRate: 16000,
  channels: 1,
  bitDepth: 16,
};
