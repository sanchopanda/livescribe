import { describe, expect, it } from 'vitest';
import { buildTranscriptRows, formatPause, PAUSE_THRESHOLD_MS } from './transcript-timeline';

function segment(id: string, tsMs: number) {
  return { id, speaker: 'Anna', text: id, tsMs, confidence: null };
}

describe('buildTranscriptRows', () => {
  it('marks a pause where the recording was stopped and resumed', () => {
    const rows = buildTranscriptRows([segment('a', 0), segment('b', 5 * 60_000)]);

    expect(rows.map((r) => r.kind)).toEqual(['segment', 'pause', 'segment']);
    expect(rows[1]).toMatchObject({ kind: 'pause', durationMs: 5 * 60_000 });
  });

  it('leaves ordinary turn-taking silence alone', () => {
    const rows = buildTranscriptRows([segment('a', 0), segment('b', 4_000), segment('c', 9_000)]);

    expect(rows.map((r) => r.kind)).toEqual(['segment', 'segment', 'segment']);
  });

  it('marks a gap exactly on the threshold', () => {
    const rows = buildTranscriptRows([segment('a', 0), segment('b', PAUSE_THRESHOLD_MS)]);

    expect(rows.map((r) => r.kind)).toEqual(['segment', 'pause', 'segment']);
  });

  it('marks every pause in a call that was paused twice', () => {
    const rows = buildTranscriptRows([
      segment('a', 0),
      segment('b', 10 * 60_000),
      segment('c', 11 * 60_000),
      segment('d', 30 * 60_000),
    ]);

    expect(rows.filter((r) => r.kind === 'pause')).toHaveLength(3);
  });

  it('gives each pause its own key', () => {
    const rows = buildTranscriptRows([segment('a', 0), segment('b', 60_000), segment('c', 180_000)]);
    const ids = rows.flatMap((r) => (r.kind === 'pause' ? [r.id] : []));

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('handles an empty transcript', () => {
    expect(buildTranscriptRows([])).toEqual([]);
  });
});

describe('formatPause', () => {
  it('reads pauses at a human scale', () => {
    expect(formatPause(45_000)).toBe('45 сек');
    expect(formatPause(60_000)).toBe('1 мин');
    expect(formatPause(12 * 60_000)).toBe('12 мин');
    expect(formatPause(60 * 60_000)).toBe('1 ч');
    expect(formatPause(95 * 60_000)).toBe('1 ч 35 мин');
  });
});
