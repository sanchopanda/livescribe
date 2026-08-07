// Метрики и сборка отчёта по логам прогонов. Всё — чистые функции над SmokeEvent[].

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ProviderName, SmokeEvent } from './types.js';

/**
 * Цены на 2026-08. Nemotron/Whisper подтверждены напрямую из каталога Together
 * (GET /v1/models: у моделей типа transcribe указано price_per_minute: 0.0015) — не вилка,
 * а точная ставка одна для всех transcribe-моделей на этом эндпоинте.
 */
const RATE_USD_PER_MIN: Record<ProviderName, number> = {
  deepgram: 0.0077, // nova-3 streaming, pay-as-you-go
  nemotron: 0.0015, // Together AI, price_per_minute из каталога моделей
  whisper: 0.0015, // Together AI, тот же тариф transcribe-моделей
  // SaluteSpeech: оценка по публичному прайсу (~1,2 ₽/мин при курсе ~80 ₽/$), НЕ подтверждено
  // собственным прогоном — провайдер вне объёма смока (облачного доступа к GigaAM для физлица
  // нет, см. docs/decisions/0005-stt-strategy-self-hosted-ru.md). Держим для полноты таблицы,
  // но это не проверенный факт.
  salute: 0.015,
};

export function timeToFirstEventMs(events: SmokeEvent[]): number | null {
  if (events.length === 0) return null;
  return Math.min(...events.map((e) => e.msFromStart));
}

export function finalCount(events: SmokeEvent[]): number {
  return events.filter((e) => e.isFinal).length;
}

/** Медиана числового массива, округлённая до целого. Пустой массив — вызывающий сам решает, что делать. */
function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(value);
}

/**
 * Насколько шкала времени провайдера (audioPosSec + durationSec) расходится с нашими часами
 * (msFromStart). НЕ измеряет воспринимаемую задержку ответа. У Deepgram расхождение (~13.6–13.8 с
 * в смоке) — это не свойство метрики и не поведение провайдера в норме, а конкретный баг прод-
 * адаптера: `tryReconnect()` в `packages/backend/src/stt/deepgram.ts` переподключается посреди
 * звонка, и новая WS-сессия Deepgram считает `start` сегментов от своего собственного нуля —
 * шкала провайдера съезжает, а `msFromStart` в смоке (от старта всего прогона) — нет. Сдвиг
 * застывает на уровне реконнекта и держится до конца звонка (плато). Заведено как LS-30
 * (`docs/backlog.md`). У провайдеров без реконнекта в сессии (Nemotron/Whisper в этом смоке)
 * та же формула даёт правдоподобные величины. Для оценки реальной отзывчивости эта метрика не
 * годится в любом случае — смотреть tailLatencyMs и medianFinalIntervalMs. Считается только по
 * событиям, где провайдер сообщил позицию; медиана, а не среднее — один долгий хвост иначе
 * перекашивает картину.
 */
export function medianFinalLagMs(events: SmokeEvent[]): number | null {
  const lags = events
    .filter((e) => e.isFinal && typeof e.audioPosSec === 'number' && typeof e.durationSec === 'number')
    .map((e) => e.msFromStart - (e.audioPosSec! + e.durationSec!) * 1000);
  return lags.length === 0 ? null : median(lags);
}

/**
 * Пришёл ли последний финал до конца аудио или после него, и на сколько. Отрицательное значение —
 * провайдер закончил раньше конца записи (в хвосте была тишина); положительное — провайдер ещё
 * «догоняет» реальный темп аудио. Это и есть ответ на продуктовый вопрос «не отстаём ли мы
 * от реального времени звонка к его концу».
 */
export function tailLatencyMs(events: SmokeEvent[], audioDurationMs: number): number | null {
  const finalTimes = events.filter((e) => e.isFinal).map((e) => e.msFromStart);
  if (finalTimes.length === 0) return null;
  return Math.round(Math.max(...finalTimes) - audioDurationMs);
}

/**
 * Медиана интервалов между приходом соседних финалов — как часто на экране появляется новый
 * кусок текста. Это главная характеристика отзывчивости для пользователя, в отличие от
 * medianFinalLagMs (расхождение шкал) и timeToFirstEventMs (разовая метрика запуска).
 */
export function medianFinalIntervalMs(events: SmokeEvent[]): number | null {
  const finalTimes = events.filter((e) => e.isFinal).map((e) => e.msFromStart).sort((a, b) => a - b);
  if (finalTimes.length < 2) return null;
  const intervals = finalTimes.slice(1).map((t, i) => t - finalTimes[i]);
  return median(intervals);
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
    const tail = tailLatencyMs(run.events, run.audioSec * 1000);
    const interval = medianFinalIntervalMs(run.events);
    const lag = medianFinalLagMs(run.events);
    return `| ${run.provider} | ${run.events.length} | ${finalCount(run.events)} | ${first ?? '—'} | ${tail ?? '—'} | ${interval ?? '—'} | ${lag ?? '—'} | $${costUsd(run.audioSec, run.provider).toFixed(4)} |`;
  });

  const transcripts = runs
    .map((run) => `### ${run.provider}\n\n${flatTranscript(run.events) || '(пусто)'}\n`)
    .join('\n');

  return [
    '# Смок-прогон облачных STT',
    '',
    '| Провайдер | Событий | Финалов | Первое событие, мс | Хвост после конца аудио, мс | Медианный интервал между финалами, мс | Сдвиг шкалы провайдера, мс | Стоимость прогона |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '_«Хвост после конца аудио» — пришёл ли последний финал раньше конца записи (отрицательное',
    'значение, в хвосте была тишина) или провайдер ещё догоняет реальный темп (положительное).',
    '«Медианный интервал между финалами» — как часто провайдер присылает новый кусок текста,',
    'главная характеристика отзывчивости. «Сдвиг шкалы провайдера» — НЕ задержка ответа: это',
    'расхождение между часами прогона и внутренней позицией сегмента, которую сообщает сам',
    'провайдер (audioPosSec + durationSec). У Deepgram это не свойство метрики, а известный баг',
    'прод-адаптера: реконнект посреди звонка (`tryReconnect()` в `src/stt/deepgram.ts`) обнуляет',
    'шкалу сегментов у новой WS-сессии, сдвиг застывает на уровне реконнекта и держится до конца',
    'записи (плато) — заведено как LS-30 (`docs/backlog.md`). Рост сдвига не означает накопление',
    'реальной задержки._',
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
  const { parseWav, wavDurationMs } = await import('./feed.js');
  const { metaPath, resolveAudioSec } = await import('./meta.js');

  const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };

  const outDir = arg('out') ?? 'scripts/stt-smoke/out';
  const base = arg('file');
  if (!base) throw new Error('Usage: --file <basename без расширения> [--out dir] [--wav-dir dir]');

  // Длительность аудио по умолчанию (для прогонов без метафайла — см. ниже) — из самого
  // WAV-файла, а не из приближения по msFromStart последнего события: провайдер может закончить
  // раньше или позже конца записи (см. tailLatencyMs), и на пустом jsonl приближение по событиям
  // давало -Infinity.
  const wavDir = arg('wav-dir') ?? 'recordings';
  const wav = parseWav(await readFile(join(wavDir, `${base}.wav`)));
  const wavDurationSec = wavDurationMs(wav) / 1000;

  const files = (await readdir(outDir)).filter((f) => f.startsWith(base) && f.endsWith('.jsonl'));
  const runs = [];
  for (const f of files) {
    const provider = f.slice(base.length + 1, -'.jsonl'.length) as ProviderName;
    const events: SmokeEvent[] = (await readFile(join(outDir, f), 'utf8'))
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));

    // Метафайл (пишет run.ts) знает фактическую длительность поданного аудио — учитывает
    // --seconds. Без него (старые прогоны) падаем обратно на длину всего WAV-файла.
    const metaRaw = await readFile(metaPath(outDir, base, provider), 'utf8').catch(() => null);
    const audioSec = resolveAudioSec(metaRaw, wavDurationSec);

    runs.push({ provider, audioSec, events });
  }

  const path = join(outDir, `${base}-report.md`);
  await writeFile(path, buildReport(runs), 'utf8');
  console.log(`Отчёт: ${path}`);
}
