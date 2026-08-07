// Метафайл длительности прогона. run.ts пишет его рядом с .jsonl/.txt с полем `audioSec` —
// фактической длительностью аудио, поданного в этот прогон (после --seconds, если он был).
// report.ts читает его, чтобы не путать обрезанный прогон с длиной всего WAV-файла (иначе
// --seconds 30 по 6-минутной записи давал tailLatencyMs ≈ −344000 и цену в 12 раз выше реальной).
// Чистые функции без файловой системы — читать/писать файл вызывающий код делает сам.

import { join } from 'node:path';
import type { ProviderName } from './types.js';

/** Имя метафайла для прогона: <basename>-<provider>.meta.json, рядом с .jsonl/.txt. */
export function metaFileName(basename: string, provider: ProviderName): string {
  return `${basename}-${provider}.meta.json`;
}

export function metaPath(outDir: string, basename: string, provider: ProviderName): string {
  return join(outDir, metaFileName(basename, provider));
}

/** Разбирает содержимое метафайла. Любая проблема (битый JSON, не число, ноль) — не значение. */
export function parseMetaAudioSec(raw: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const audioSec = (parsed as { audioSec?: unknown } | null)?.audioSec;
  return typeof audioSec === 'number' && Number.isFinite(audioSec) && audioSec > 0 ? audioSec : null;
}

/**
 * Итоговая длительность прогона для отчёта: метафайл — источник истины (знает про --seconds),
 * длина WAV-файла — запасной вариант, если метафайла нет (старые прогоны без него) или он битый.
 */
export function resolveAudioSec(metaRaw: string | null, wavDurationSec: number): number {
  if (metaRaw === null) return wavDurationSec;
  return parseMetaAudioSec(metaRaw) ?? wavDurationSec;
}
