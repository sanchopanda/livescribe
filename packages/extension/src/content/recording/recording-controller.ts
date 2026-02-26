import type { AudioMode } from '../platform/platform-adapter';
import type { PlatformForStart } from '../platform/platform-detector';

interface TrackModeController {
  ensureStarted: (reason: string) => void;
  scheduleStartRetry: (reason: string, delayMs?: number) => void;
  stop: () => Promise<void>;
}

interface RecordingControllerDeps {
  getIsCapturing: () => boolean;
  setIsCapturing: (value: boolean) => void;
  getSelectedLanguage: () => string;
  getPlatformForStartMessage: () => PlatformForStart;
  getAudioMode: () => AudioMode;
  shouldLogAudioMode: () => boolean;
  updateStatus: (status: 'idle' | 'recording' | 'error' | 'waiting', error?: string) => void;
  startSpeakerTracking: () => void;
  stopSpeakerTracking: () => void;
  trackModeController: TrackModeController;
}

export class RecordingController {
  constructor(private readonly deps: RecordingControllerDeps) {}

  async start(): Promise<void> {
    if (this.deps.getIsCapturing()) {
      return;
    }

    try {
      this.deps.updateStatus('idle');
      const language = this.deps.getSelectedLanguage();

      const response = await new Promise<any>((resolve) => {
        const audioMode = this.deps.getAudioMode();
        chrome.runtime.sendMessage(
          {
            type: 'START_RECORDING',
            language,
            platform: this.deps.getPlatformForStartMessage(),
            audioMode,
          },
          resolve,
        );
      });

      if (chrome.runtime.lastError) {
        const message = chrome.runtime.lastError.message;
        console.error('Failed to start recording:', chrome.runtime.lastError);
        this.deps.updateStatus('error', message);
        return;
      }

      if (response && response.error) {
        console.error('Failed to start recording:', response.error);
        this.deps.updateStatus('error', response.error);
        return;
      }

      this.deps.setIsCapturing(true);
      this.deps.updateStatus('recording');
      this.deps.startSpeakerTracking();

      if (this.deps.shouldLogAudioMode()) {
        console.log('[LiveScribe] audio mode', {
          platform: this.deps.getPlatformForStartMessage(),
          mode: this.deps.getAudioMode(),
        });
      }

      this.deps.trackModeController.ensureStarted('handleStart:response');
      this.deps.trackModeController.scheduleStartRetry('handleStart:response', 700);
      this.deps.trackModeController.scheduleStartRetry('handleStart:response', 1600);

      console.log('Recording started via service worker + offscreen');
    } catch (err) {
      console.error('Failed to start capture:', err);
      this.deps.updateStatus('error', (err as Error).message);
    }
  }

  async stop(): Promise<void> {
    this.deps.setIsCapturing(false);
    this.deps.stopSpeakerTracking();

    await this.deps.trackModeController.stop();

    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, () => {
      if (chrome.runtime.lastError) {
        console.error('Failed to stop recording:', chrome.runtime.lastError);
      }
      console.log('Recording stopped via service worker');
    });

    this.deps.updateStatus('idle');
  }
}
