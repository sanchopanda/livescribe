import type { PlatformForStart } from '../content/platform/platform-detector';

/**
 * Откуда берётся текст встречи. `per-track`/`mixed` — захват аудио, `meet-captions` — готовый
 * текст из субтитров платформы (LS-36). Один селектор с тремя значениями, а не две независимые
 * оси: «аудио per-track + текст из субтитров» жгло бы аудио впустую, и такое состояние не должно
 * быть выразимо.
 */
export type TranscriptSource = 'per-track' | 'mixed' | 'meet-captions';

export interface PlatformCapabilities {
  supportsPerTrackAudioMode: boolean;
  supportsSpeakerDomDetection: boolean;
  supportsMainWorldWebRTCHook: boolean;
  supportsMixedCapture: boolean;
  /** Умеет ли платформа отдавать транскрипт из собственных субтитров (LS-36). */
  supportsCaptionSource: boolean;
}

const DEFAULT_PLATFORM_CAPABILITIES: PlatformCapabilities = {
  supportsPerTrackAudioMode: false,
  supportsSpeakerDomDetection: false,
  supportsMainWorldWebRTCHook: false,
  supportsMixedCapture: true,
  supportsCaptionSource: false,
};

const PLATFORM_CAPABILITIES: Record<Exclude<PlatformForStart, undefined>, PlatformCapabilities> = {
  meet: {
    supportsPerTrackAudioMode: true,
    supportsSpeakerDomDetection: true,
    supportsMainWorldWebRTCHook: true,
    supportsMixedCapture: true,
    supportsCaptionSource: true,
  },
  zoom: {
    supportsPerTrackAudioMode: false,
    supportsSpeakerDomDetection: false,
    supportsMainWorldWebRTCHook: false,
    supportsMixedCapture: true,
    supportsCaptionSource: false,
  },
  teams: {
    supportsPerTrackAudioMode: false,
    supportsSpeakerDomDetection: true,
    supportsMainWorldWebRTCHook: false,
    supportsMixedCapture: true,
    supportsCaptionSource: false,
  },
  pachca: {
    supportsPerTrackAudioMode: true,
    supportsSpeakerDomDetection: true,
    supportsMainWorldWebRTCHook: true,
    supportsMixedCapture: true,
    supportsCaptionSource: false,
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

export function supportsCaptionTranscriptSource(platform: PlatformForStart): boolean {
  return getPlatformCapabilities(platform).supportsCaptionSource;
}

/**
 * Действующий источник транскрипта. Платформа, которая чего-то не умеет, не должна получать это
 * значение: описывать несуществующий пайплайн — та же ошибка, что чинил LS-21.
 */
export function resolveTranscriptSource(
  source: TranscriptSource | undefined,
  platform?: PlatformForStart,
): TranscriptSource {
  if (source === 'meet-captions') {
    return supportsCaptionTranscriptSource(platform) ? 'meet-captions' : 'mixed';
  }

  if (!supportsPerTrackAudioMode(platform)) {
    return 'mixed';
  }

  return source === 'mixed' ? 'mixed' : 'per-track';
}

/** Нужен ли для этого источника захват аудио вкладки или дорожек. */
export function requiresAudioCapture(source: TranscriptSource): boolean {
  return source !== 'meet-captions';
}
