import { getMeetAudioMode } from '../config/audio-mode';
import { MeetTrackTranscriber } from '../audio/per-track/track-transcriber';

interface MeetTrackModeControllerParams {
  getIsCapturing: () => boolean;
  getSessionId: () => string | null;
}

export class MeetTrackModeController {
  private readonly transcriber = new MeetTrackTranscriber();
  private retryTimerId: number | null = null;

  constructor(private readonly params: MeetTrackModeControllerParams) {}

  ensureStarted(reason: string): void {
    const mode = getMeetAudioMode();
    if (mode !== 'per-track') {
      console.log('[LiveScribe][Meet][TrackTranscriber] skip start: mixed mode enabled', { reason });
      return;
    }

    if (!this.params.getIsCapturing()) {
      console.log('[LiveScribe][Meet][TrackTranscriber] skip start: not capturing', { reason });
      return;
    }

    const sessionId = this.params.getSessionId();
    if (!sessionId) {
      console.log('[LiveScribe][Meet][TrackTranscriber] skip start: sessionId is not ready', { reason });
      return;
    }

    this.transcriber.start(sessionId).catch((err) => {
      console.warn('Failed to start Meet per-track transcriber:', err);
    });
  }

  scheduleStartRetry(reason: string, delayMs = 600): void {
    if (getMeetAudioMode() !== 'per-track') return;

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
