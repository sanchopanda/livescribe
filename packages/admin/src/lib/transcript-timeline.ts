import type { TranscriptSegmentDTO } from '@skribo/shared';

/**
 * A recording can be paused and resumed inside one call, and reconnects leave gaps of their own.
 * Segment offsets are measured from the meeting's start, so a pause is simply a hole in the
 * timeline — this turns holes above the threshold into something the transcript can show, so a
 * reader does not mistake a gap for continuous speech.
 */

/** Shorter holes are ordinary turn-taking silence, not a pause worth marking. */
export const PAUSE_THRESHOLD_MS = 60_000;

export type TranscriptRow =
  | { kind: 'segment'; segment: TranscriptSegmentDTO }
  | { kind: 'pause'; id: string; durationMs: number };

export function buildTranscriptRows(
  segments: TranscriptSegmentDTO[],
  thresholdMs: number = PAUSE_THRESHOLD_MS,
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];

  segments.forEach((segment, index) => {
    const previous = segments[index - 1];
    if (previous) {
      const gap = segment.tsMs - previous.tsMs;
      if (gap >= thresholdMs) {
        rows.push({ kind: 'pause', id: `pause-${previous.id}-${segment.id}`, durationMs: gap });
      }
    }
    rows.push({ kind: 'segment', segment });
  });

  return rows;
}

/** "12 мин" / "45 сек" — the length of a pause, rounded to something a human reads. */
export function formatPause(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds} сек`;

  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes} мин`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}
