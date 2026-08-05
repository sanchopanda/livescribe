import { describe, expect, it } from 'vitest';
import { buildTranscriptSegmentRecord } from './handler.js';

const SESSION_START = 1_700_000_000_000;

function sessionWith(overrides: { meetingId?: string; startedAtMs?: number } = {}) {
  return {
    meetingId: 'meetingId' in overrides ? overrides.meetingId : 'meeting_1',
    startedAtMs: 'startedAtMs' in overrides ? overrides.startedAtMs : SESSION_START,
  } as any;
}

describe('buildTranscriptSegmentRecord', () => {
  it('persists a final segment of a mixed session', () => {
    const record = buildTranscriptSegmentRecord(
      sessionWith(),
      { isFinal: true, text: 'привет команда', confidence: 0.91 },
      'Anna',
      SESSION_START + 4_000,
    );

    expect(record).toEqual({
      meetingId: 'meeting_1',
      speaker: 'Anna',
      text: 'привет команда',
      tsMs: 4_000,
      confidence: 0.91,
    });
  });

  it('persists a per-track segment under the participant speaker', () => {
    // Per-track capture is the whole point of this function existing: each participant's
    // stream used to reach the client and never the database.
    const record = buildTranscriptSegmentRecord(
      sessionWith(),
      { isFinal: true, text: 'мой апдейт', confidence: 0.8 },
      'Participant a1b2c3',
      SESSION_START + 12_500,
    );

    expect(record).toMatchObject({ speaker: 'Participant a1b2c3', tsMs: 12_500 });
  });

  it('skips partial results', () => {
    const record = buildTranscriptSegmentRecord(
      sessionWith(),
      { isFinal: false, text: 'приве' },
      'Anna',
      SESSION_START + 1_000,
    );

    expect(record).toBeNull();
  });

  it('skips anonymous sessions that have no meeting to attach to', () => {
    const record = buildTranscriptSegmentRecord(
      sessionWith({ meetingId: undefined }),
      { isFinal: true, text: 'привет' },
      'Anna',
      SESSION_START + 1_000,
    );

    expect(record).toBeNull();
  });

  it('skips blank text', () => {
    const session = sessionWith();

    expect(
      buildTranscriptSegmentRecord(session, { isFinal: true, text: '   ' }, 'Anna', SESSION_START),
    ).toBeNull();
    expect(
      buildTranscriptSegmentRecord(session, { isFinal: true }, 'Anna', SESSION_START),
    ).toBeNull();
  });

  it('skips a result that arrives after the session is gone', () => {
    const record = buildTranscriptSegmentRecord(
      undefined,
      { isFinal: true, text: 'привет' },
      'Anna',
      SESSION_START,
    );

    expect(record).toBeNull();
  });

  it('trims the text and stores no speaker when none is known', () => {
    const record = buildTranscriptSegmentRecord(
      sessionWith(),
      { isFinal: true, text: '  привет  ' },
      undefined,
      SESSION_START + 500,
    );

    expect(record).toMatchObject({ text: 'привет', speaker: null, confidence: null });
  });

  it('falls back to a zero offset when the session start is unknown', () => {
    const record = buildTranscriptSegmentRecord(
      sessionWith({ startedAtMs: undefined }),
      { isFinal: true, text: 'привет' },
      'Anna',
      SESSION_START + 9_000,
    );

    expect(record).toMatchObject({ tsMs: 0 });
  });

  it('ignores a non-numeric confidence', () => {
    const record = buildTranscriptSegmentRecord(
      sessionWith(),
      { isFinal: true, text: 'привет', confidence: 'high' as unknown as number },
      'Anna',
      SESSION_START,
    );

    expect(record).toMatchObject({ confidence: null });
  });
});
