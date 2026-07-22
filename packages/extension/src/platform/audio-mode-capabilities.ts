import type { PlatformForStart } from '../content/platform/platform-detector';

export type AudioMode = 'per-track' | 'mixed';

export interface PlatformCapabilities {
  supportsPerTrackAudioMode: boolean;
  supportsSpeakerDomDetection: boolean;
  supportsMainWorldWebRTCHook: boolean;
  supportsMixedCapture: boolean;
}

const DEFAULT_PLATFORM_CAPABILITIES: PlatformCapabilities = {
  supportsPerTrackAudioMode: false,
  supportsSpeakerDomDetection: false,
  supportsMainWorldWebRTCHook: false,
  supportsMixedCapture: true,
};

const PLATFORM_CAPABILITIES: Record<Exclude<PlatformForStart, undefined>, PlatformCapabilities> = {
  meet: {
    supportsPerTrackAudioMode: true,
    supportsSpeakerDomDetection: true,
    supportsMainWorldWebRTCHook: true,
    supportsMixedCapture: true,
  },
  zoom: {
    supportsPerTrackAudioMode: false,
    supportsSpeakerDomDetection: false,
    supportsMainWorldWebRTCHook: false,
    supportsMixedCapture: true,
  },
  teams: {
    supportsPerTrackAudioMode: false,
    supportsSpeakerDomDetection: true,
    supportsMainWorldWebRTCHook: false,
    supportsMixedCapture: true,
  },
  pachca: {
    supportsPerTrackAudioMode: true,
    supportsSpeakerDomDetection: true,
    supportsMainWorldWebRTCHook: true,
    supportsMixedCapture: true,
  },
};

export function getPlatformCapabilities(platform: PlatformForStart): PlatformCapabilities {
  if (!platform) {
    return DEFAULT_PLATFORM_CAPABILITIES;
  }

  return PLATFORM_CAPABILITIES[platform] ?? DEFAULT_PLATFORM_CAPABILITIES;
}

export function supportsPerTrackAudioMode(platform: PlatformForStart): boolean {
  return getPlatformCapabilities(platform).supportsPerTrackAudioMode;
}

export function resolveAudioMode(audioMode: AudioMode | undefined): AudioMode {
  if (audioMode === 'mixed') {
    return 'mixed';
  }

  return 'per-track';
}
