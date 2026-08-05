import { describe, expect, it } from 'vitest';
import { canResumeMeeting, buildTranscriptSegmentRecord } from './handler.js';

const USER = 'user_1';

describe('canResumeMeeting', () => {
  it('resumes the caller’s own meeting', () => {
    expect(canResumeMeeting({ id: 'm1', userId: USER }, USER)).toBe(true);
  });

  it('refuses a meeting belonging to somebody else', () => {
    // A resume id is client-supplied, so it must never be trusted to name the owner.
    expect(canResumeMeeting({ id: 'm1', userId: 'someone_else' }, USER)).toBe(false);
  });

  it('refuses an unknown meeting', () => {
    expect(canResumeMeeting(null, USER)).toBe(false);
  });
});

describe('segment offsets across a reconnect', () => {
  it('keeps timestamps relative to the original meeting start', () => {
    // A reconnect 60s in must not restart the clock: the resumed session carries the
    // original meeting's start, so segment offsets stay continuous.
    const meetingStart = 1_700_000_000_000;
    const resumedSession = { meetingId: 'm1', startedAtMs: meetingStart } as any;

    const record = buildTranscriptSegmentRecord(
      resumedSession,
      { isFinal: true, text: 'после реконнекта' },
      'Anna',
      meetingStart + 65_000,
    );

    expect(record).toMatchObject({ meetingId: 'm1', tsMs: 65_000 });
  });
});
