import type { TrackEnergy } from './speaker-binding';

export interface TrackEnergySample {
  rms: number;
  at: number;
}

/**
 * How long a level stays meaningful. Energy is recorded from every chunk before the VAD gate
 * runs, so silence does not arrive as absence of data — but a track that ended or went silent at
 * the source stops producing chunks altogether, and its last recorded sample must not be read as
 * still-loud forever once it goes stale.
 */
export const ENERGY_FRESH_MS = 400;

export function recordTrackEnergy(
  store: Map<string, TrackEnergySample>,
  trackId: string,
  rms: number,
  now: number,
): void {
  store.set(trackId, { rms, at: now });
}

export function collectTrackEnergies(
  store: Map<string, TrackEnergySample>,
  trackIds: readonly string[],
  now: number,
): TrackEnergy[] {
  return trackIds.map((trackId) => {
    const sample = store.get(trackId);
    const fresh = sample && now - sample.at <= ENERGY_FRESH_MS;
    return { trackId, rms: fresh ? sample.rms : 0 };
  });
}
