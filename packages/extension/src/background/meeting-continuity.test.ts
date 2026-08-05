import { describe, expect, it } from 'vitest';
import {
  buildCallKey,
  resolveResumeMeetingId,
  MEETING_CONTINUITY_WINDOW_MS,
} from './meeting-continuity';

const NOW = 1_700_000_000_000;

describe('buildCallKey', () => {
  it('tells two calls apart on every platform', () => {
    const pairs = [
      ['https://meet.google.com/aaa-bbbb-ccc', 'https://meet.google.com/xxx-yyyy-zzz'],
      ['https://us02web.zoom.us/j/87654321098', 'https://us02web.zoom.us/j/11111111111'],
      [
        'https://teams.cloud.microsoft/l/meetup-join/19%3ameeting_AAA%40thread.v2/0',
        'https://teams.cloud.microsoft/l/meetup-join/19%3ameeting_BBB%40thread.v2/0',
      ],
      ['https://app.pachca.com/chats/456789', 'https://app.pachca.com/chats/999999'],
    ];

    for (const [first, second] of pairs) {
      expect(buildCallKey(first, 7)).not.toBe(buildCallKey(second, 7));
    }
  });

  it('keeps one call identical while the url picks up noise', () => {
    // These appear and change mid-call; letting them into the key would split the meeting.
    const base = buildCallKey('https://meet.google.com/aaa-bbbb-ccc', 7);

    expect(buildCallKey('https://meet.google.com/aaa-bbbb-ccc?hs=1&authuser=0', 7)).toBe(base);
    expect(buildCallKey('https://meet.google.com/aaa-bbbb-ccc#pip', 7)).toBe(base);
    expect(buildCallKey('https://meet.google.com/aaa-bbbb-ccc/', 7)).toBe(base);
  });

  it('does not confuse two calls in the same tab', () => {
    expect(buildCallKey('https://app.pachca.com/chats/1', 7)).not.toBe(
      buildCallKey('https://app.pachca.com/chats/2', 7),
    );
  });

  it('falls back to the tab when the url carries no path', () => {
    expect(buildCallKey('https://app.pachca.com/', 7)).toBe('tab:7');
    expect(buildCallKey(undefined, 7)).toBe('tab:7');
    expect(buildCallKey('not a url', 7)).toBe('tab:7');
  });

  it('gives up when there is neither a usable url nor a tab', () => {
    expect(buildCallKey(undefined, undefined)).toBeNull();
    expect(buildCallKey('https://app.pachca.com/', undefined)).toBeNull();
  });
});

describe('resolveResumeMeetingId', () => {
  const callKey = 'https://meet.google.com/aaa-bbbb-ccc';
  const remembered = { meetingId: 'm1', callKey, lastActiveAtMs: NOW - 5_000 };

  it('continues the same call after a manual stop and start', () => {
    // Pausing mid-meeting is one call with a gap in it, not two meetings.
    expect(resolveResumeMeetingId(remembered, callKey, NOW)).toBe('m1');
  });

  it('continues after a long pause that is still inside the window', () => {
    const paused = { ...remembered, lastActiveAtMs: NOW - (MEETING_CONTINUITY_WINDOW_MS - 1_000) };

    expect(resolveResumeMeetingId(paused, callKey, NOW)).toBe('m1');
  });

  it('starts a new meeting once the pause outlives the window', () => {
    const stale = { ...remembered, lastActiveAtMs: NOW - (MEETING_CONTINUITY_WINDOW_MS + 1) };

    expect(resolveResumeMeetingId(stale, callKey, NOW)).toBeNull();
  });

  it('starts a new meeting for a different call in the same tab', () => {
    expect(resolveResumeMeetingId(remembered, 'https://meet.google.com/xxx-yyyy-zzz', NOW)).toBeNull();
  });

  it('starts a new meeting when nothing is remembered', () => {
    expect(resolveResumeMeetingId(null, callKey, NOW)).toBeNull();
  });

  it('starts a new meeting when the call cannot be identified', () => {
    expect(resolveResumeMeetingId(remembered, null, NOW)).toBeNull();
  });
});
