import type { TranscriptSource } from '../../../../platform/audio-mode-capabilities';

const STORAGE_KEY = 'livescribe-meet-audio-mode';

/**
 * Ключ намеренно оставлен прежним (`…-audio-mode`): у пользователей в localStorage уже лежит
 * выбранный режим, и переименование ключа молча сбросило бы его на дефолт.
 */
export function getMeetTranscriptSource(): TranscriptSource {
  try {
    const raw = (localStorage.getItem(STORAGE_KEY) || '').trim().toLowerCase();
    if (raw === 'mixed') return 'mixed';
    if (raw === 'meet-captions') return 'meet-captions';
  } catch {
    // ignore localStorage errors
  }

  return 'per-track';
}

export function setMeetTranscriptSource(source: TranscriptSource): void {
  try {
    localStorage.setItem(STORAGE_KEY, source);
  } catch {
    // ignore localStorage errors
  }
}
