import { describe, expect, it } from 'vitest';
import {
  appendSpeakerChange,
  pickSpeakerAt,
  segmentSpokenAt,
  SPEAKER_LOOKAHEAD_MS,
} from './speaker-timeline.js';

describe('appendSpeakerChange', () => {
  it('records changes in order', () => {
    const timeline = appendSpeakerChange(
      appendSpeakerChange([], { at: 1000, speaker: 'Anna' }),
      { at: 2000, speaker: 'Boris' },
    );

    expect(timeline.map((c) => c.speaker)).toEqual(['Anna', 'Boris']);
  });

  it('ignores repeats of the current speaker', () => {
    // The DOM poll fires four times a second; only transitions are interesting.
    const timeline: Parameters<typeof appendSpeakerChange>[0] = [];
    appendSpeakerChange(timeline, { at: 1000, speaker: 'Anna' });
    appendSpeakerChange(timeline, { at: 1250, speaker: 'Anna' });
    appendSpeakerChange(timeline, { at: 1500, speaker: 'Boris' });

    expect(timeline).toHaveLength(2);
  });

  it('keeps a silence marker as a distinct entry', () => {
    const timeline: Parameters<typeof appendSpeakerChange>[0] = [];
    appendSpeakerChange(timeline, { at: 1000, speaker: 'Anna' });
    appendSpeakerChange(timeline, { at: 2000, speaker: null });

    expect(timeline.map((c) => c.speaker)).toEqual(['Anna', null]);
  });

  it('drops the oldest entries past the limit', () => {
    const timeline: Parameters<typeof appendSpeakerChange>[0] = [];
    for (let i = 0; i < 10; i += 1) {
      appendSpeakerChange(timeline, { at: i * 100, speaker: `s${i}` }, 3);
    }

    expect(timeline).toHaveLength(3);
    expect(timeline.map((c) => c.speaker)).toEqual(['s7', 's8', 's9']);
  });
});

describe('pickSpeakerAt', () => {
  const timeline = [
    { at: 1_000, speaker: 'Anna' },
    { at: 5_000, speaker: 'Boris' },
    { at: 9_000, speaker: 'Anna' },
  ];

  it('picks whoever was speaking at that moment, not the latest one', () => {
    // This is the whole point: a segment spoken at 6s must not be labelled with the speaker
    // who took over at 9s, even if the transcript only arrives at 10s.
    expect(pickSpeakerAt(timeline, 6_000)?.speaker).toBe('Boris');
    expect(pickSpeakerAt(timeline, 2_000)?.speaker).toBe('Anna');
    expect(pickSpeakerAt(timeline, 12_000)?.speaker).toBe('Anna');
  });

  it('allows for the DOM indicator lagging speech onset', () => {
    // Boris starts talking at ~4.7s but the tile lights up at 5s.
    expect(pickSpeakerAt(timeline, 5_000 - SPEAKER_LOOKAHEAD_MS + 1)?.speaker).toBe('Boris');
    expect(pickSpeakerAt(timeline, 5_000 - SPEAKER_LOOKAHEAD_MS - 1)?.speaker).toBe('Anna');
  });

  it('returns undefined before the first known change', () => {
    expect(pickSpeakerAt(timeline, 0)).toBeUndefined();
    expect(pickSpeakerAt([], 5_000)).toBeUndefined();
  });
});

describe('segmentSpokenAt', () => {
  it('maps an STT stream offset onto wall-clock time', () => {
    expect(segmentSpokenAt(1_000_000, 2.5)).toBe(1_002_500);
    expect(segmentSpokenAt(1_000_000, 0)).toBe(1_000_000);
  });

  it('gives up when the stream start or the offset is unknown', () => {
    expect(segmentSpokenAt(undefined, 2.5)).toBeUndefined();
    expect(segmentSpokenAt(1_000_000, undefined)).toBeUndefined();
    expect(segmentSpokenAt(1_000_000, Number.NaN)).toBeUndefined();
    expect(segmentSpokenAt(1_000_000, -1)).toBeUndefined();
  });
});
