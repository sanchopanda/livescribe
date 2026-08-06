// Метрики и сборка отчёта по логам прогонов. Всё — чистые функции над SmokeEvent[].

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ProviderName, SmokeEvent } from './types.js';

/** Цены на 2026-08. Together отдаёт разные числа на своих страницах — берём консервативное. */
const RATE_USD_PER_MIN: Record<ProviderName, number> = {
  deepgram: 0.0077, // nova-3 streaming, pay-as-you-go
  nemotron: 0.0045, // Together AI, верхняя граница вилки 0.0015–0.0045
  salute: 0.015, // SaluteSpeech ~1,2 ₽/мин при курсе ~80 ₽/$
};

export function timeToFirstEventMs(events: SmokeEvent[]): number | null {
  if (events.length === 0) return null;
  return Math.min(...events.map((e) => e.msFromStart));
}

export function finalCount(events: SmokeEvent[]): number {
  return events.filter((e) => e.isFinal).length;
}

/**
 * Насколько финал отстаёт от конца своего сегмента в аудио. Считается только по событиям,
 * где провайдер сообщил позицию: иначе «отставание» не определено. Медиана, а не среднее —
 * один долгий хвост в конце записи иначе перекашивает картину.
 */
export function medianFinalLagMs(events: SmokeEvent[]): number | null {
  const lags = events
    .filter((e) => e.isFinal && typeof e.audioPosSec === 'number' && typeof e.durationSec === 'number')
    .map((e) => e.msFromStart - (e.audioPosSec! + e.durationSec!) * 1000);
  if (lags.length === 0) return null;
  const sorted = [...lags].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function flatTranscript(events: SmokeEvent[]): string {
  return events.filter((e) => e.isFinal).map((e) => e.text.trim()).filter(Boolean).join(' ');
}

export function costUsd(audioSec: number, provider: ProviderName): number {
  return (audioSec / 60) * RATE_USD_PER_MIN[provider];
}

export function buildReport(runs: Array<{ provider: ProviderName; audioSec: number; events: SmokeEvent[] }>): string {
  const rows = runs.map((run) => {
    const first = timeToFirstEventMs(run.events);
    const lag = medianFinalLagMs(run.events);
    return `| ${run.provider} | ${run.events.length} | ${finalCount(run.events)} | ${first ?? '—'} | ${lag ?? '—'} | $${costUsd(run.audioSec, run.provider).toFixed(4)} |`;
  });

  const transcripts = runs
    .map((run) => `### ${run.provider}\n\n${flatTranscript(run.events) || '(пусто)'}\n`)
    .join('\n');

  return [
    '# Смок-прогон облачных STT',
    '',
    '| Провайдер | Событий | Финалов | Первое событие, мс | Медианное отставание финала, мс | Стоимость прогона |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## Транскрипты',
    '',
    transcripts,
  ].join('\n');
}

// --- CLI ---
// npm run stt:report -- --file recording-62a7123a-2026-02-18T08-04-37-722Z --out scripts/stt-smoke/out
const invokedDirectly = process.argv[1]
  ? realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedDirectly) {
  const { readFile, writeFile, readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };

  const outDir = arg('out') ?? 'scripts/stt-smoke/out';
  const base = arg('file');
  if (!base) throw new Error('Usage: --file <basename без расширения> [--out dir]');

  const files = (await readdir(outDir)).filter((f) => f.startsWith(base) && f.endsWith('.jsonl'));
  const runs = [];
  for (const f of files) {
    const provider = f.slice(base.length + 1, -'.jsonl'.length) as ProviderName;
    const events: SmokeEvent[] = (await readFile(join(outDir, f), 'utf8'))
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));
    // Приближение: последнее событие приходит позже конца аудио, но это даёт верхнюю границу стоимости.
    const audioSec = Math.max(...events.map((e) => e.msFromStart)) / 1000;
    runs.push({ provider, audioSec, events });
  }

  const path = join(outDir, `${base}-report.md`);
  await writeFile(path, buildReport(runs), 'utf8');
  console.log(`Отчёт: ${path}`);
}
