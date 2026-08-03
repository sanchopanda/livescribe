// Who was speaking when.
//
// In mixed capture the speaker name comes from the platform's DOM, while the transcript comes
// from Deepgram a second or three later. Labelling a segment with "whoever the DOM says right
// now" mislabels every phrase that lands after the speaker has already changed. So we keep the
// changes on a timeline and look up the speaker for the moment the words were actually spoken.
//
// Timestamps are taken when the update reaches the server, which keeps client and server
// clocks out of the picture — WebSocket delivery lag is tens of milliseconds, far below the
// STT lag this exists to fix.

export interface SpeakerChange {
  /** Server time (ms) when the update arrived. */
  at: number;
  speaker: string | null;
  participantId?: string;
}

/** Enough for hours of a call; the cap only exists so a long session cannot grow unbounded. */
export const SPEAKER_TIMELINE_LIMIT = 500;

/**
 * The DOM speaking indicator lights up slightly after speech begins, so a change recorded a
 * little after the segment start still describes that segment.
 */
export const SPEAKER_LOOKAHEAD_MS = 750;

/**
 * Append a change, ignoring repeats of the current speaker. Returns the same array instance
 * so callers can keep holding it.
 */
export function appendSpeakerChange(
  timeline: SpeakerChange[],
  change: SpeakerChange,
  limit: number = SPEAKER_TIMELINE_LIMIT,
): SpeakerChange[] {
  const last = timeline[timeline.length - 1];
  if (last && last.speaker === change.speaker) {
    return timeline;
  }

  timeline.push(change);
  if (timeline.length > limit) {
    timeline.splice(0, timeline.length - limit);
  }
  return timeline;
}

/**
 * Who was speaking at `atMs`. Returns undefined when the timeline says nothing about that
 * moment — the caller then falls back to the last known speaker.
 */
export function pickSpeakerAt(
  timeline: SpeakerChange[],
  atMs: number,
  lookaheadMs: number = SPEAKER_LOOKAHEAD_MS,
): SpeakerChange | undefined {
  let match: SpeakerChange | undefined;

  for (const change of timeline) {
    if (change.at <= atMs + lookaheadMs) {
      match = change;
    } else {
      break; // timeline is append-only, so it is already ordered
    }
  }

  return match;
}

/**
 * Wall-clock moment a transcript segment was spoken, from the STT stream offset.
 * Returns undefined when either the stream start or the offset is unknown.
 */
export function segmentSpokenAt(
  streamStartedAtMs: number | undefined,
  startSec: number | undefined,
): number | undefined {
  if (typeof streamStartedAtMs !== 'number' || typeof startSec !== 'number') return undefined;
  if (!Number.isFinite(startSec) || startSec < 0) return undefined;
  return streamStartedAtMs + startSec * 1000;
}
