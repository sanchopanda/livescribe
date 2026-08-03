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

/**
 * The effective capture mode. A platform that cannot do per-track is always mixed, whatever
 * the caller asked for — defaulting an unknown or per-track-less platform to 'per-track' would
 * describe a pipeline that does not exist there (Teams mixes audio server-side, for instance).
 */
export function resolveAudioMode(
  audioMode: AudioMode | undefined,
  platform?: PlatformForStart,
): AudioMode {
  if (!supportsPerTrackAudioMode(platform)) {
    return 'mixed';
  }

  return audioMode === 'mixed' ? 'mixed' : 'per-track';
}
