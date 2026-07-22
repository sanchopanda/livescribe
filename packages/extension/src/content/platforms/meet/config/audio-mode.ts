export type MeetAudioMode = 'per-track' | 'mixed';

const STORAGE_KEY = 'livescribe-meet-audio-mode';

export function getMeetAudioMode(): MeetAudioMode {
  try {
    const raw = (localStorage.getItem(STORAGE_KEY) || '').trim().toLowerCase();
    if (raw === 'mixed') return 'mixed';
  } catch {
    // ignore localStorage errors
  }

  return 'per-track';
}

export function setMeetAudioMode(mode: MeetAudioMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore localStorage errors
  }
}
