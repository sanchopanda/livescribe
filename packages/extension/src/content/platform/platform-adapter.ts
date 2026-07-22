import { getPlatformForStartMessage, type PlatformForStart } from './platform-detector';
import {
  getPlatformCapabilities,
  supportsPerTrackAudioMode,
} from '../../platform/audio-mode-capabilities';
import { getPachcaActiveSpeaker } from '../platforms/pachca/speaker/active-speaker-dom';
import { getTeamsActiveSpeaker } from '../platforms/teams/speaker/active-speaker-dom';
import { getMeetActiveSpeaker } from '../platforms/meet/speaker/active-speaker-dom';
import {
  getPachcaAudioMode,
  setPachcaAudioMode,
} from '../platforms/pachca/config/audio-mode';
import {
  getMeetAudioMode,
  setMeetAudioMode,
} from '../platforms/meet/config/audio-mode';
import { PachcaTrackModeController } from '../platforms/pachca/recording/track-mode-controller';
import { MeetTrackModeController } from '../platforms/meet/recording/track-mode-controller';

interface TrackModeController {
  ensureStarted: (reason: string) => void;
  scheduleStartRetry: (reason: string, delayMs?: number) => void;
  stop: () => Promise<void>;
}

interface PlatformAdapterParams {
  getIsCapturing: () => boolean;
  getSessionId: () => string | null;
}

interface ActiveSpeakerInfo {
  participantId: string;
  speaker: string | null;
}

export type AudioMode = 'per-track' | 'mixed';

export interface PlatformAdapter {
  getPlatform: () => PlatformForStart;
  supportsAudioModeSelection: () => boolean;
  getAudioMode: () => AudioMode;
  setAudioMode: (mode: AudioMode) => void;
  getActiveSpeaker: () => ActiveSpeakerInfo | null;
  getTrackModeController: () => TrackModeController;
}

const noOpTrackModeController: TrackModeController = {
  ensureStarted: () => undefined,
  scheduleStartRetry: () => undefined,
  stop: async () => undefined,
};

const speakerDetectors: Partial<Record<Exclude<PlatformForStart, undefined>, () => ActiveSpeakerInfo | null>> = {
  pachca: getPachcaActiveSpeaker,
  teams: getTeamsActiveSpeaker,
  meet: getMeetActiveSpeaker,
};

export function createPlatformAdapter(params: PlatformAdapterParams): PlatformAdapter {
  const platform = getPlatformForStartMessage();
  const capabilities = getPlatformCapabilities(platform);

  const trackModeController = (() => {
    if (platform === 'pachca') {
      return new PachcaTrackModeController({
        getIsCapturing: params.getIsCapturing,
        getSessionId: params.getSessionId,
      });
    }
    if (platform === 'meet') {
      return new MeetTrackModeController({
        getIsCapturing: params.getIsCapturing,
        getSessionId: params.getSessionId,
      });
    }
    return null;
  })();

  return {
    getPlatform: () => platform,
    supportsAudioModeSelection: () => capabilities.supportsPerTrackAudioMode,
    getAudioMode: (): AudioMode => {
      if (!supportsPerTrackAudioMode(platform)) return 'mixed';
      if (platform === 'pachca') return getPachcaAudioMode();
      if (platform === 'meet') return getMeetAudioMode();
      return 'mixed';
    },
    setAudioMode: (mode) => {
      if (!supportsPerTrackAudioMode(platform)) return;
      if (platform === 'pachca') setPachcaAudioMode(mode);
      if (platform === 'meet') setMeetAudioMode(mode);
    },
    getActiveSpeaker: () => {
      if (!platform || !capabilities.supportsSpeakerDomDetection) {
        return null;
      }

      return speakerDetectors[platform]?.() ?? null;
    },
    getTrackModeController: () => trackModeController ?? noOpTrackModeController,
  };
}
