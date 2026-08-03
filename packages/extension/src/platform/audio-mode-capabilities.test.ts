import { describe, expect, it } from 'vitest';
import { resolveAudioMode, supportsPerTrackAudioMode } from './audio-mode-capabilities';

describe('resolveAudioMode', () => {
  it('keeps per-track platforms switchable', () => {
    expect(resolveAudioMode('per-track', 'meet')).toBe('per-track');
    expect(resolveAudioMode('mixed', 'meet')).toBe('mixed');
    expect(resolveAudioMode(undefined, 'pachca')).toBe('per-track');
  });

  it('forces mixed where per-track does not exist', () => {
    // Teams mixes audio server-side; Zoom has no per-track pipeline yet.
    expect(supportsPerTrackAudioMode('teams')).toBe(false);
    expect(resolveAudioMode(undefined, 'teams')).toBe('mixed');
    expect(resolveAudioMode('per-track', 'teams')).toBe('mixed');
    expect(resolveAudioMode('per-track', 'zoom')).toBe('mixed');
  });

  it('falls back to mixed for an unknown platform', () => {
    expect(resolveAudioMode(undefined, undefined)).toBe('mixed');
    expect(resolveAudioMode('per-track', undefined)).toBe('mixed');
  });
});
