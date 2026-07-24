export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(sec: number | null): string {
  if (!sec || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m} мин${s ? ` ${s} с` : ''}`;
  const h = Math.floor(m / 60);
  return `${h} ч ${m % 60} мин`;
}

const PLATFORM_LABELS: Record<string, string> = {
  meet: 'Google Meet', zoom: 'Zoom', teams: 'MS Teams', pachca: 'Pachca',
};
export function platformLabel(p: string | null): string {
  if (!p) return 'Звонок';
  return PLATFORM_LABELS[p] ?? p;
}
