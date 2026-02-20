export type PachcaAudioMode = 'per-track' | 'mixed';

const STORAGE_KEY = 'livescribe-pachca-audio-mode';

export function getPachcaAudioMode(): PachcaAudioMode {
  try {
    const raw = (localStorage.getItem(STORAGE_KEY) || '').trim().toLowerCase();
    if (raw === 'mixed') return 'mixed';
  } catch {
    // ignore localStorage errors
  }

  return 'per-track';
}

export function setPachcaAudioMode(mode: PachcaAudioMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore localStorage errors
  }
}

