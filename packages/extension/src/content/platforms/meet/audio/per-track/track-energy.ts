import type { TrackEnergy } from './speaker-binding';

export interface TrackEnergySample {
  rms: number;
  at: number;
}

/**
 * How long a level stays meaningful. A track that stopped sending chunks is silent, not loud
 * forever — VAD gates sending, so silence arrives as absence of data.
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
