/**
 * Keeping one call in one cabinet entry.
 *
 * A recording can stop and start again several times inside a single meeting — the user pauses
 * while something private is discussed, then resumes. Those are not separate meetings, so the
 * transcript continues into the same one and the gap shows up as a pause (segment offsets are
 * measured from the meeting's start, so the silence is visible in the timeline without storing
 * anything extra).
 *
 * What identifies "the same call" is its URL: every platform puts a call id in there, and two
 * different meetings differ by it even in the same tab. Where the URL says nothing the tab is the
 * fallback, and a time window stops a page that stays open all day from swallowing tomorrow's
 * meeting into yesterday's.
 */

export const MEETING_CONTINUITY_WINDOW_MS = 30 * 60 * 1000;

export interface RememberedMeeting {
  meetingId: string;
  /** Identity of the call this meeting belongs to, from `buildCallKey`. */
  callKey: string;
  /** When this meeting last had a live recording — a pause is measured from here. */
  lastActiveAtMs: number;
}

/**
 * Stable identity for the call being recorded, or `null` when neither the URL nor the tab can
 * name one.
 *
 * Every platform already puts the call id somewhere in the path, so the path *is* the identity —
 * no per-platform knowledge needed. Query and hash are dropped on purpose: they carry things
 * that change while a call is running (`?hs=`, `?pwd=`, `?context=`, `#pip`), and letting them
 * into the key would split a call the moment one of them moved. Falls back to the tab for a page
 * whose URL says nothing useful.
 */
export function buildCallKey(url: string | undefined, tabId: number | undefined): string | null {
  const fallback = tabId === undefined ? null : `tab:${tabId}`;
  if (!url) return fallback;

  try {
    const { origin, pathname } = new URL(url);
    const path = pathname.replace(/\/+$/, '');
    if (!path) return fallback;

    return `${origin}${path}`.toLowerCase();
  } catch {
    return fallback;
  }
}

/**
 * The meeting a recording starting now should continue, or `null` to open a new one.
 */
export function resolveResumeMeetingId(
  remembered: RememberedMeeting | null | undefined,
  callKey: string | null,
  nowMs: number,
  windowMs: number = MEETING_CONTINUITY_WINDOW_MS,
): string | null {
  if (!remembered || !callKey) return null;
  if (remembered.callKey !== callKey) return null;
  if (nowMs - remembered.lastActiveAtMs > windowMs) return null;

  return remembered.meetingId;
}
