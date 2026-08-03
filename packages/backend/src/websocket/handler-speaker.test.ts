import { describe, expect, it } from 'vitest';
import { resolveSpeakerForSegment } from './handler.js';
import type { SpeakerChange } from './speaker-timeline.js';

const STREAM_START = 1_000_000;

function sessionWith(overrides: {
  speaker?: string | null;
  timeline?: SpeakerChange[];
  sttStreamStartedAtMs?: number;
}) {
  return {
    speaker: overrides.speaker ?? null,
    speakerTimeline: overrides.timeline ?? [],
    sttStreamStartedAtMs:
      'sttStreamStartedAtMs' in overrides ? overrides.sttStreamStartedAtMs : STREAM_START,
  } as any;
}

const timeline: SpeakerChange[] = [
  { at: STREAM_START + 1_000, speaker: 'Anna' },
  { at: STREAM_START + 5_000, speaker: 'Boris' },
  { at: STREAM_START + 9_000, speaker: 'Anna' },
];

describe('resolveSpeakerForSegment', () => {
  it('labels a segment with whoever spoke it, not with the current speaker', () => {
    // Boris spoke at ~6s; by the time Deepgram delivered the text Anna had taken over.
    const session = sessionWith({ speaker: 'Anna', timeline });

    expect(resolveSpeakerForSegment(session, { startSec: 6 })).toBe('Boris');
  });

  it('still works for a segment at the very start of a turn', () => {
    const session = sessionWith({ speaker: 'Anna', timeline });

    expect(resolveSpeakerForSegment(session, { startSec: 1 })).toBe('Anna');
    expect(resolveSpeakerForSegment(session, { startSec: 9.5 })).toBe('Anna');
  });

  it('prefers a speaker that came with the result (per-track capture)', () => {
    const session = sessionWith({ speaker: 'Anna', timeline });

    expect(resolveSpeakerForSegment(session, { speaker: 'Clara', startSec: 6 })).toBe('Clara');
  });

  it('falls back to the last known speaker without timing', () => {
    const session = sessionWith({ speaker: 'Anna', timeline });

    expect(resolveSpeakerForSegment(session, { text: 'no timings here' })).toBe('Anna');
  });

  it('falls back when audio has not started yet', () => {
    const session = sessionWith({ speaker: 'Anna', timeline, sttStreamStartedAtMs: undefined });

    expect(resolveSpeakerForSegment(session, { startSec: 6 })).toBe('Anna');
  });

  it('falls back for a segment older than the first speaker update', () => {
    const session = sessionWith({ speaker: 'Anna', timeline });

    expect(resolveSpeakerForSegment(session, { startSec: 0 })).toBe('Anna');
  });

  it('returns undefined when nothing is known', () => {
    expect(resolveSpeakerForSegment(sessionWith({}), { startSec: 6 })).toBeUndefined();
    expect(resolveSpeakerForSegment(undefined, { startSec: 6 })).toBeUndefined();
  });

  it('reports silence as no speaker rather than as the previous one', () => {
    const session = sessionWith({
      speaker: null,
      timeline: [
        { at: STREAM_START + 1_000, speaker: 'Anna' },
        { at: STREAM_START + 4_000, speaker: null },
      ],
    });

    expect(resolveSpeakerForSegment(session, { startSec: 6 })).toBeUndefined();
  });
});
