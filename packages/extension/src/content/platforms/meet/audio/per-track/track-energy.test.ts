import { describe, expect, it } from 'vitest';
import { collectTrackEnergies, ENERGY_FRESH_MS, recordTrackEnergy } from './track-energy';

const TRACK_A = 'track-a';
const TRACK_B = 'track-b';
const NOW = 1_786_474_658_000;

describe('collectTrackEnergies', () => {
  it('отдаёт свежий уровень дорожки', () => {
    const store = new Map();
    recordTrackEnergy(store, TRACK_A, 0.09, NOW);

    expect(collectTrackEnergies(store, [TRACK_A], NOW + 100)).toEqual([
      { trackId: TRACK_A, rms: 0.09 },
    ]);
  });

  it('считает устаревший уровень тишиной', () => {
    // Молчащая дорожка чанков не присылает: без этого правила её последний громкий уровень
    // остался бы «активным» навсегда и наблюдение никогда не было бы чистым.
    const store = new Map();
    recordTrackEnergy(store, TRACK_A, 0.09, NOW);

    expect(collectTrackEnergies(store, [TRACK_A], NOW + ENERGY_FRESH_MS + 1)).toEqual([
      { trackId: TRACK_A, rms: 0 },
    ]);
  });

  it('отдаёт нуль для дорожки, по которой уровня ещё не было', () => {
    expect(collectTrackEnergies(new Map(), [TRACK_B], NOW)).toEqual([{ trackId: TRACK_B, rms: 0 }]);
  });

  it('перезаписывает уровень новым замером', () => {
    const store = new Map();
    recordTrackEnergy(store, TRACK_A, 0.09, NOW);
    recordTrackEnergy(store, TRACK_A, 0.01, NOW + 50);

    expect(collectTrackEnergies(store, [TRACK_A], NOW + 60)).toEqual([
      { trackId: TRACK_A, rms: 0.01 },
    ]);
  });
});
