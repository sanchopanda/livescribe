import { getPachcaAudioMode } from '../config/audio-mode';
import { PachcaTrackTranscriber } from '../audio/per-track/track-transcriber';

interface PachcaTrackModeControllerParams {
  getIsCapturing: () => boolean;
  getSessionId: () => string | null;
}

export class PachcaTrackModeController {
  private readonly transcriber = new PachcaTrackTranscriber();
  private retryTimerId: number | null = null;

  constructor(private readonly params: PachcaTrackModeControllerParams) {}

  ensureStarted(reason: string): void {
    const mode = getPachcaAudioMode();
    if (mode !== 'per-track') {
      console.log('[LiveScribe][Pachca][TrackTranscriber] skip start: mixed mode enabled', { reason });
      return;
    }

    if (!this.params.getIsCapturing()) {
      console.log('[LiveScribe][Pachca][TrackTranscriber] skip start: not capturing', { reason });
      return;
    }

    const sessionId = this.params.getSessionId();
    if (!sessionId) {
      console.log('[LiveScribe][Pachca][TrackTranscriber] skip start: sessionId is not ready', { reason });
      return;
    }

    this.transcriber.start(sessionId).catch((err) => {
      console.warn('Failed to start Pachca per-track transcriber:', err);
    });
  }

  scheduleStartRetry(reason: string, delayMs = 600): void {
    if (getPachcaAudioMode() !== 'per-track') return;

    if (this.retryTimerId !== null) {
      clearTimeout(this.retryTimerId);
    }

    this.retryTimerId = window.setTimeout(() => {
      this.retryTimerId = null;
      this.ensureStarted(`${reason}:retry`);
    }, delayMs);
  }

  async stop(): Promise<void> {
    if (this.retryTimerId !== null) {
      clearTimeout(this.retryTimerId);
      this.retryTimerId = null;
    }

    await this.transcriber.stop();
  }
}
