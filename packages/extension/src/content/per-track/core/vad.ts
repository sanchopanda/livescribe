import type { ChunkSignalMetrics } from './audio-signal';

export interface TrackVadState {
  active: boolean;
  lastVoiceAt: number;
}

export const VAD_DEFAULTS = {
  rmsOn: 0.02,
  rmsOff: 0.01,
  peakOverride: 0.12,
  hangoverMs: 1000,
} as const;

export interface VadDecision {
  shouldSend: boolean;
  opened: boolean;
  closed: boolean;
  state: TrackVadState;
}

export function decideVad(
  prevState: TrackVadState | undefined,
  signal: ChunkSignalMetrics,
  now: number,
  config = VAD_DEFAULTS,
): VadDecision {
  const state: TrackVadState = prevState || { active: false, lastVoiceAt: 0 };
  const isStrongSpeech = signal.rms >= config.rmsOn || signal.peak >= config.peakOverride;

  let shouldSend = false;
  let opened = false;
  let closed = false;

  if (state.active) {
    if (signal.rms >= config.rmsOff || signal.peak >= config.peakOverride) {
      state.lastVoiceAt = now;
    }

    if (now - state.lastVoiceAt <= config.hangoverMs) {
      shouldSend = true;
    } else {
      state.active = false;
      closed = true;
    }
  } else if (isStrongSpeech) {
    state.active = true;
    state.lastVoiceAt = now;
    shouldSend = true;
    opened = true;
  }

  return { shouldSend, opened, closed, state };
}
