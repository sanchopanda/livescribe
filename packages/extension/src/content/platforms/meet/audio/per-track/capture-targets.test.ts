import { describe, expect, it } from 'vitest';
import { fallbackParticipantId, resolveCaptureTargets } from './capture-targets';

// Track ids as seen on a live Meet call: two remote inbound tracks plus the local microphone.
const REMOTE_A = '33f1a44f-0d1e-4af0-a9c6-bba5b1d58b73';
const REMOTE_B = 'd5c1572e-9cfa-43eb-ae4c-b9c23b398f88';
const LOCAL = 'a1b2c3d4-0000-4000-8000-000000000000';

describe('resolveCaptureTargets', () => {
  it('captures a track whose participant tile is known', () => {
    const owners = new Map([
      [REMOTE_A, { participantId: 'spaces/Z2eZuCUpKwIB/devices/555', speaker: 'Сергей Чумеров' }],
    ]);

    expect(resolveCaptureTargets([REMOTE_A], owners)).toEqual([
      {
        trackId: REMOTE_A,
        participantId: 'spaces/Z2eZuCUpKwIB/devices/555',
        speaker: 'Сергей Чумеров',
      },
    ]);
  });

  it('captures tracks that could not be matched to a tile', () => {
    // Meet stopped exposing the ssrc on its tiles, so remote tracks resolve no owner. Capture used
    // to iterate the owner map, so those tracks were never recorded and only the local microphone
    // reached the transcript (LS-35). An unnamed speaker is recoverable; lost audio is not.
    const owners = new Map([[LOCAL, { participantId: 'self', speaker: 'Вы' }]]);

    expect(resolveCaptureTargets([REMOTE_A, REMOTE_B, LOCAL], owners)).toEqual([
      { trackId: REMOTE_A, participantId: fallbackParticipantId(REMOTE_A), speaker: null },
      { trackId: REMOTE_B, participantId: fallbackParticipantId(REMOTE_B), speaker: null },
      { trackId: LOCAL, participantId: 'self', speaker: 'Вы' },
    ]);
  });

  it('gives each unnamed track its own participant id', () => {
    // The backend opens one recognition stream per participantId, so two speakers sharing an id
    // would have their speech interleaved into one transcript.
    const targets = resolveCaptureTargets([REMOTE_A, REMOTE_B], new Map());
    expect(targets[0].participantId).not.toBe(targets[1].participantId);
  });

  it('keeps the id stable across rescans', () => {
    expect(fallbackParticipantId(REMOTE_A)).toBe(fallbackParticipantId(REMOTE_A));
  });

  it('reports each track once even when it is registered twice', () => {
    expect(resolveCaptureTargets([REMOTE_A, REMOTE_A], new Map())).toHaveLength(1);
  });

  it('ignores empty track ids', () => {
    expect(resolveCaptureTargets(['', '   '], new Map())).toEqual([]);
  });

  it('returns nothing when the registry is empty', () => {
    expect(resolveCaptureTargets([], new Map())).toEqual([]);
  });
});

describe('fallbackParticipantId', () => {
  it('marks the id as a participant so the backend can label it', () => {
    // The backend strips this prefix and shows the remainder, so it must stay short and readable.
    expect(fallbackParticipantId(REMOTE_A)).toBe('participant_33f1a44f');
  });

  it('survives a short track id', () => {
    expect(fallbackParticipantId('abc')).toBe('participant_abc');
  });
});
