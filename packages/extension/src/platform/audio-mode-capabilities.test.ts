import { describe, expect, it } from 'vitest';
import {
  requiresAudioCapture,
  resolveTranscriptSource,
  supportsCaptionTranscriptSource,
} from './audio-mode-capabilities';

describe('resolveTranscriptSource', () => {
  it('оставляет субтитры там, где платформа их умеет', () => {
    expect(resolveTranscriptSource('meet-captions', 'meet')).toBe('meet-captions');
  });

  it('не отдаёт субтитры платформе без них', () => {
    // Иначе виджет описывал бы пайплайн, которого на этой платформе не существует, — та же
    // ошибка, что чинил LS-21 для per-track.
    expect(resolveTranscriptSource('meet-captions', 'teams')).toBe('mixed');
    expect(resolveTranscriptSource('meet-captions', 'zoom')).toBe('mixed');
    expect(resolveTranscriptSource('meet-captions', undefined)).toBe('mixed');
  });

  it('платформа без per-track всегда mixed', () => {
    expect(resolveTranscriptSource('per-track', 'teams')).toBe('mixed');
    expect(resolveTranscriptSource(undefined, 'zoom')).toBe('mixed');
  });

  it('по умолчанию per-track там, где он есть', () => {
    expect(resolveTranscriptSource(undefined, 'meet')).toBe('per-track');
    expect(resolveTranscriptSource('mixed', 'meet')).toBe('mixed');
  });
});

describe('requiresAudioCapture', () => {
  it('субтитры не требуют захвата аудио', () => {
    expect(requiresAudioCapture('meet-captions')).toBe(false);
  });

  it('аудио-режимы требуют захвата', () => {
    expect(requiresAudioCapture('mixed')).toBe(true);
    expect(requiresAudioCapture('per-track')).toBe(true);
  });
});

describe('supportsCaptionTranscriptSource', () => {
  it('включён только на Meet', () => {
    expect(supportsCaptionTranscriptSource('meet')).toBe(true);
    expect(supportsCaptionTranscriptSource('pachca')).toBe(false);
    expect(supportsCaptionTranscriptSource('teams')).toBe(false);
    expect(supportsCaptionTranscriptSource('zoom')).toBe(false);
    expect(supportsCaptionTranscriptSource(undefined)).toBe(false);
  });
});
