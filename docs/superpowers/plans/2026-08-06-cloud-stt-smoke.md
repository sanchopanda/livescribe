# Cloud STT Smoke (Nemotron 3.5 / GigaAM vs nova-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Прогнать одну и ту же реальную запись звонка через Deepgram nova-3, Nemotron 3.5 ASR Streaming (Together AI) и GigaAM (SaluteSpeech) в стриминговом режиме и получить сопоставимые транскрипты, метрики латентности и стоимость.

**Architecture:** Одноразовый CLI-скрипт в `packages/backend/scripts/stt-smoke/`. Общий «проигрыватель» WAV отдаёт PCM-чанки по 100 мс в реальном темпе; каждый провайдер — тонкий адаптер, который превращает поток чанков в единый формат событий `SmokeEvent` и пишет его в JSONL. Отчёт считается из JSONL отдельным модулем чистых функций. Прод-код (`src/stt/`) не меняется, кроме переиспользования существующего `DeepgramSTT` как эталона.

**Tech Stack:** TypeScript ESM, tsx (запуск), vitest (тесты), `ws` (WebSocket к Together), `@grpc/grpc-js` + `@grpc/proto-loader` (SaluteSpeech), существующий `@deepgram/sdk`.

**Спека:** `docs/superpowers/specs/2026-08-06-cloud-stt-smoke-design.md`
**Ресёрч/ADR:** `docs/research/2026-07-26-stt-models-parakeet-gigaam.md`, `docs/decisions/0005-stt-strategy-self-hosted-ru.md`

## Global Constraints

- **Прод не трогаем.** `packages/backend/src/stt/types.ts` (`STTProviderType = 'deepgram'`) и `src/stt/index.ts` не изменяются ни в одной задаче. Новые адаптеры живут только в `scripts/stt-smoke/` и не обязаны реализовывать интерфейс `STTProvider`.
- **Env только внутри функций.** `packages/backend/.env` загружается dotenv **после** импорта модулей, поэтому `const KEY = process.env.X` на верхнем уровне модуля даёт `undefined`. Читать env исключительно внутри функций (как `getApiKey()` в `src/stt/deepgram.ts:23`). Скрипт вызывает `config({ path: ... })` первой строкой в `run.ts` до остальной работы.
- **ESM-импорты с расширением `.js`** в относительных путях (практика репо: `import type { STTProvider } from './types.js'`).
- **Домешные термины в коде — по-английски**, комментарии и доки — по-русски (правило репо).
- **Аудио-формат фиксирован:** PCM signed 16-bit little-endian, 16 000 Гц, 1 канал. Чанк 100 мс = **3200 байт**. Перекодирования нет ни на одном шаге.
- **Секреты и приватность:** ключи только в `packages/backend/.env` (в `.gitignore`). Каталог `out/` и любые транскрипты реальных звонков **не коммитятся**. Записи в `packages/backend/recordings/` уже игнорируются (`.gitignore:78`).
- **Коммиты — прямо в `main`** (практика репо), по одному на задачу, только файлы этой задачи.
- **Доска:** перед началом реализации завести/взять карточку в Vikunja (проект Skribo, id 5) и перевести в «В работе», после реализации — «На проверке». Делается автономно, механика — в скилле `task-board`.
- **Правило остановки:** Nemotron доводится до конца (Задачи 1–4). SaluteSpeech (Задача 5) — после. Если Задача 5 упирается в TLS-сертификат или в недоступность proto-файлов, делается **одна** попытка обхода по описанному рецепту; если не помогло — фиксируем findings в README скрипта, коммитим и останавливаемся, не задерживая результат по Nemotron.

## Тестовые данные

Обе записи уже PCM s16le / 16 kHz / mono, лежат в `packages/backend/recordings/`:

- `recording-62a7123a-2026-02-18T08-04-37-722Z.wav` — 1:56, короткая, для первых прогонов;
- `recording-f11102c6-2026-02-18T08-38-22-258Z.wav` — 6:14, длинная, на стабильность сессии.

## File Structure

| Файл | Ответственность |
| --- | --- |
| `packages/backend/scripts/stt-smoke/types.ts` | `SmokeEvent`, `SmokeRunner`, `ProviderName` — общий контракт между feed, провайдерами и отчётом |
| `packages/backend/scripts/stt-smoke/feed.ts` | Чистая логика: разбор WAV-заголовка, нарезка PCM на чанки, подача в реальном темпе. **Покрыто тестами** |
| `packages/backend/scripts/stt-smoke/feed.test.ts` | Тесты `parseWav`, `chunkPcm`, `feedRealtime` |
| `packages/backend/scripts/stt-smoke/sink.ts` | Запись событий в `out/<basename>-<provider>.jsonl` и плоского текста в `.txt` |
| `packages/backend/scripts/stt-smoke/run.ts` | CLI: разбор аргументов, dotenv, выбор провайдера, склейка feed → provider → sink, итоговая сводка |
| `packages/backend/scripts/stt-smoke/providers/deepgram.ts` | Адаптер поверх существующего `DeepgramSTT` — эталон |
| `packages/backend/scripts/stt-smoke/providers/nemotron.ts` | WebSocket-адаптер Together AI |
| `packages/backend/scripts/stt-smoke/providers/salute.ts` | OAuth + gRPC-адаптер SaluteSpeech |
| `packages/backend/scripts/stt-smoke/report.ts` | Чистые функции метрик и сборка markdown-отчёта. **Покрыто тестами** |
| `packages/backend/scripts/stt-smoke/report.test.ts` | Тесты метрик и расчёта стоимости |
| `packages/backend/scripts/stt-smoke/README.md` | Как получить ключи, как запускать, известные грабли (TLS Сбера), findings |
| `packages/backend/tsconfig.scripts.json` | `noEmit` type-check для `scripts/**` (основной tsconfig ограничен `src/**`) |
| `packages/backend/package.json` | Скрипты `stt:smoke`, `type-check:scripts`; devDependencies `ws`, `@grpc/grpc-js`, `@grpc/proto-loader` |
| `.gitignore` | Игнор `packages/backend/scripts/stt-smoke/out/` |

---

### Task 1: Проигрыватель WAV (`feed.ts`)

Чистая, полностью тестируемая часть: разбор заголовка, нарезка, подача по часам.

**Files:**
- Create: `packages/backend/scripts/stt-smoke/types.ts`
- Create: `packages/backend/scripts/stt-smoke/feed.ts`
- Test: `packages/backend/scripts/stt-smoke/feed.test.ts`
- Create: `packages/backend/tsconfig.scripts.json`
- Modify: `packages/backend/package.json` (скрипт `type-check:scripts`)

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `interface WavPcm { sampleRate: number; channels: number; bitsPerSample: number; data: Buffer }`
  - `function parseWav(buf: Buffer): WavPcm`
  - `function chunkPcm(data: Buffer, bytesPerChunk: number): Buffer[]`
  - `function bytesPerChunk(wav: WavPcm, chunkMs: number): number`
  - `async function feedRealtime(chunks: Buffer[], chunkMs: number, send: (chunk: Buffer, index: number) => void | Promise<void>, clock?: { now: () => number; sleep: (ms: number) => Promise<void> }): Promise<void>`
  - из `types.ts`: `interface SmokeEvent { msFromStart: number; isFinal: boolean; text: string; audioPosSec?: number; durationSec?: number }`, `type ProviderName = 'deepgram' | 'nemotron' | 'salute'`, `interface SmokeRunner { start(onEvent: (e: Omit<SmokeEvent, 'msFromStart'>) => void): Promise<void>; send(chunk: Buffer): void | Promise<void>; finish(trailingMs: number): Promise<void> }`

- [ ] **Step 1: Написать `types.ts`** (контракт нужен раньше тестов, кода в нём нет)

```ts
// Общий контракт смок-прогона: одинаковый формат событий у всех провайдеров —
// только это и делает транскрипты сравнимыми построчно.

/** Одна реплика от провайдера, привязанная ко времени прогона. */
export interface SmokeEvent {
  /** Миллисекунды от начала подачи аудио — момент, когда событие пришло к нам. */
  msFromStart: number;
  isFinal: boolean;
  text: string;
  /** Позиция сегмента в аудио, если провайдер её сообщает (секунды от начала). */
  audioPosSec?: number;
  /** Длительность сегмента в секундах, если провайдер её сообщает. */
  durationSec?: number;
}

export type ProviderName = 'deepgram' | 'nemotron' | 'salute';

/** Адаптер одного провайдера. Не путать с прод-интерфейсом STTProvider — здесь свой, узкий. */
export interface SmokeRunner {
  /** Открыть соединение и подписаться на результаты. */
  start(onEvent: (event: Omit<SmokeEvent, 'msFromStart'>) => void): Promise<void>;
  /** Отправить один чанк PCM. */
  send(chunk: Buffer): void | Promise<void>;
  /** Сообщить о конце аудио и подождать хвостовые финалы не дольше trailingMs. */
  finish(trailingMs: number): Promise<void>;
}
```

- [ ] **Step 2: Написать падающие тесты `feed.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseWav, chunkPcm, bytesPerChunk, feedRealtime } from './feed.js';

/** Собирает минимальный валидный WAV: RIFF + fmt + (опционально LIST) + data. */
function buildWav(pcm: Buffer, opts: { sampleRate?: number; channels?: number; extraChunk?: boolean } = {}): Buffer {
  const sampleRate = opts.sampleRate ?? 16000;
  const channels = opts.channels ?? 1;
  const bitsPerSample = 16;
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8); // PCM
  fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(sampleRate, 12);
  fmt.writeUInt32LE((sampleRate * channels * bitsPerSample) / 8, 16);
  fmt.writeUInt16LE((channels * bitsPerSample) / 8, 20);
  fmt.writeUInt16LE(bitsPerSample, 22);

  const list = Buffer.alloc(12);
  list.write('LIST', 0, 'ascii');
  list.writeUInt32LE(4, 4);
  list.write('INFO', 8, 'ascii');

  const dataHeader = Buffer.alloc(8);
  dataHeader.write('data', 0, 'ascii');
  dataHeader.writeUInt32LE(pcm.length, 4);

  const body = Buffer.concat(opts.extraChunk ? [fmt, list, dataHeader, pcm] : [fmt, dataHeader, pcm]);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(4 + body.length, 4);
  riff.write('WAVE', 8, 'ascii');
  return Buffer.concat([riff, body]);
}

describe('parseWav', () => {
  it('читает формат и полезную нагрузку', () => {
    const pcm = Buffer.alloc(6400, 7);
    const wav = parseWav(buildWav(pcm));
    expect(wav.sampleRate).toBe(16000);
    expect(wav.channels).toBe(1);
    expect(wav.bitsPerSample).toBe(16);
    expect(wav.data.length).toBe(6400);
    expect(wav.data[0]).toBe(7);
  });

  it('находит data после посторонних чанков вроде LIST', () => {
    const pcm = Buffer.alloc(3200, 3);
    const wav = parseWav(buildWav(pcm, { extraChunk: true }));
    expect(wav.data.length).toBe(3200);
    expect(wav.data[0]).toBe(3);
  });

  it('отвергает не-WAV', () => {
    expect(() => parseWav(Buffer.from('definitely not a wav file'))).toThrow(/RIFF|WAVE/i);
  });
});

describe('bytesPerChunk', () => {
  it('100 мс моно 16 кГц s16le = 3200 байт', () => {
    expect(bytesPerChunk({ sampleRate: 16000, channels: 1, bitsPerSample: 16, data: Buffer.alloc(0) }, 100)).toBe(3200);
  });
});

describe('chunkPcm', () => {
  it('нарезает ровно и оставляет остаток последним чанком', () => {
    const chunks = chunkPcm(Buffer.alloc(3200 * 2 + 100), 3200);
    expect(chunks.map((c) => c.length)).toEqual([3200, 3200, 100]);
  });

  it('не режет сэмпл пополам: длина каждого чанка кратна 2', () => {
    const chunks = chunkPcm(Buffer.alloc(3200 * 3), 3200);
    for (const c of chunks) expect(c.length % 2).toBe(0);
  });

  it('на пустых данных отдаёт пустой список', () => {
    expect(chunkPcm(Buffer.alloc(0), 3200)).toEqual([]);
  });
});

describe('feedRealtime', () => {
  it('отдаёт все чанки по порядку', async () => {
    const seen: number[] = [];
    const chunks = [Buffer.alloc(2, 1), Buffer.alloc(2, 2), Buffer.alloc(2, 3)];
    await feedRealtime(chunks, 100, (chunk, i) => { seen.push(chunk[0]); expect(i).toBe(seen.length - 1); }, fakeClock());
    expect(seen).toEqual([1, 2, 3]);
  });

  it('держит темп по часам, а не по накоплению задержек', async () => {
    const clock = fakeClock();
    // send сам «тратит» 40 мс: пауза до следующего чанка должна стать 60, а не 100.
    await feedRealtime([Buffer.alloc(2), Buffer.alloc(2)], 100, () => { clock.advance(40); }, clock);
    expect(clock.sleeps).toEqual([60, 60]);
  });

  it('не спит отрицательное время, если отправка отстала', async () => {
    const clock = fakeClock();
    await feedRealtime([Buffer.alloc(2), Buffer.alloc(2)], 100, () => { clock.advance(250); }, clock);
    expect(clock.sleeps.every((ms) => ms >= 0)).toBe(true);
  });
});

/** Управляемые часы: время двигается только вручную и через sleep. */
function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => { sleeps.push(ms); t += ms; },
    advance: (ms: number) => { t += ms; },
    sleeps,
  };
}
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `cd packages/backend && npx vitest run scripts/stt-smoke/feed.test.ts`
Expected: FAIL — `Failed to resolve import "./feed.js"`.

- [ ] **Step 4: Реализовать `feed.ts`**

```ts
// Проигрыватель WAV для смок-прогона: превращает файл в поток PCM-чанков,
// отдаваемых в том же темпе, в котором их прислал бы живой звонок.

export interface WavPcm {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  data: Buffer;
}

export interface Clock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const defaultClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Разбирает RIFF/WAVE, пропуская посторонние чанки (LIST, fact и прочие). */
export function parseWav(buf: Buffer): WavPcm {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file');
  }

  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let data: Buffer | null = null;

  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      // Некоторые писатели ставят size = 0 или врут о длине — берём остаток файла.
      const end = size > 0 ? Math.min(body + size, buf.length) : buf.length;
      data = buf.subarray(body, end);
    }

    offset = body + size + (size % 2); // чанки выровнены по 2 байта
  }

  if (!data) throw new Error('WAVE file has no data chunk');
  if (bitsPerSample !== 16) throw new Error(`Expected 16-bit PCM, got ${bitsPerSample}-bit`);

  return { sampleRate, channels, bitsPerSample, data };
}

/** Сколько байт занимает chunkMs миллисекунд этого формата. */
export function bytesPerChunk(wav: Pick<WavPcm, 'sampleRate' | 'channels' | 'bitsPerSample'>, chunkMs: number): number {
  const bytesPerSample = (wav.bitsPerSample / 8) * wav.channels;
  return Math.round((wav.sampleRate * chunkMs) / 1000) * bytesPerSample;
}

/** Режет PCM на куски по size байт; последний может быть короче. */
export function chunkPcm(data: Buffer, size: number): Buffer[] {
  if (size <= 0) throw new Error('Chunk size must be positive');
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    chunks.push(data.subarray(offset, Math.min(offset + size, data.length)));
  }
  return chunks;
}

/**
 * Отдаёт чанки в реальном темпе. Пауза считается от абсолютного расписания
 * (i * chunkMs), а не «поспать chunkMs после отправки» — иначе время, потраченное
 * на send, накапливается и прогон уезжает от реального времени звонка.
 */
export async function feedRealtime(
  chunks: Buffer[],
  chunkMs: number,
  send: (chunk: Buffer, index: number) => void | Promise<void>,
  clock: Clock = defaultClock,
): Promise<void> {
  const startedAt = clock.now();
  for (let i = 0; i < chunks.length; i++) {
    await send(chunks[i], i);
    const dueAt = startedAt + (i + 1) * chunkMs;
    const waitMs = dueAt - clock.now();
    if (waitMs > 0) await clock.sleep(waitMs);
  }
}
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `cd packages/backend && npx vitest run scripts/stt-smoke/feed.test.ts`
Expected: PASS, 10 тестов.

- [ ] **Step 6: Добавить type-check для scripts**

Основной `tsconfig.json` ограничен `src/**`, поэтому `scripts/**` иначе не проверяется.

Создать `packages/backend/tsconfig.scripts.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["scripts/**/*", "src/**/*"]
}
```

В `packages/backend/package.json` в `scripts` добавить строку после `"type-check"`:

```json
"type-check:scripts": "tsc -p tsconfig.scripts.json",
```

- [ ] **Step 7: Проверить type-check**

Run: `cd packages/backend && npm run type-check:scripts`
Expected: без ошибок.

- [ ] **Step 8: Коммит**

```bash
git add packages/backend/scripts/stt-smoke/types.ts \
        packages/backend/scripts/stt-smoke/feed.ts \
        packages/backend/scripts/stt-smoke/feed.test.ts \
        packages/backend/tsconfig.scripts.json \
        packages/backend/package.json
git commit -m "feat(smoke): проигрыватель WAV для смок-прогона STT"
```

---

### Task 2: CLI и эталонный прогон на Deepgram

Первый сквозной результат: команда, которая гоняет запись через nova-3 и пишет JSONL.

**Files:**
- Create: `packages/backend/scripts/stt-smoke/sink.ts`
- Create: `packages/backend/scripts/stt-smoke/providers/deepgram.ts`
- Create: `packages/backend/scripts/stt-smoke/run.ts`
- Create: `packages/backend/scripts/stt-smoke/README.md`
- Modify: `packages/backend/package.json` (скрипт `stt:smoke`)
- Modify: `.gitignore` (игнор `out/`)

**Interfaces:**
- Consumes: `parseWav`, `chunkPcm`, `bytesPerChunk`, `feedRealtime` из `../feed.js`; `SmokeEvent`, `SmokeRunner`, `ProviderName` из `../types.js`; класс `DeepgramSTT` из `../../src/stt/deepgram.js`.
- Produces:
  - `class EventSink { constructor(outDir: string, basename: string, provider: ProviderName); add(event: SmokeEvent): void; get events(): SmokeEvent[]; close(): Promise<{ jsonlPath: string; txtPath: string }> }`
  - `function createDeepgramRunner(language: string): SmokeRunner`
  - CLI: `npm run stt:smoke -- --file <wav> --provider deepgram|nemotron|salute [--language ru] [--seconds N] [--out <dir>] [--raw]`

- [ ] **Step 1: Написать `sink.ts`**

Тестов здесь нет сознательно: это тонкая обёртка над `fs`, вся считаемая логика — в `report.ts` (Задача 4).

```ts
// Складывает события прогона: построчный JSONL (для отчёта) и плоский текст (для чтения глазами).

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import type { ProviderName, SmokeEvent } from './types.js';

export class EventSink {
  private readonly collected: SmokeEvent[] = [];
  private readonly stream: WriteStream;
  private readonly jsonlPath: string;
  private readonly txtPath: string;

  constructor(outDir: string, basename: string, provider: ProviderName) {
    mkdirSync(outDir, { recursive: true });
    this.jsonlPath = join(outDir, `${basename}-${provider}.jsonl`);
    this.txtPath = join(outDir, `${basename}-${provider}.txt`);
    this.stream = createWriteStream(this.jsonlPath, { encoding: 'utf8' });
  }

  add(event: SmokeEvent): void {
    this.collected.push(event);
    this.stream.write(`${JSON.stringify(event)}\n`);
  }

  get events(): SmokeEvent[] {
    return this.collected;
  }

  async close(): Promise<{ jsonlPath: string; txtPath: string }> {
    const finals = this.collected.filter((e) => e.isFinal).map((e) => e.text.trim()).filter(Boolean);
    await new Promise<void>((resolve, reject) => {
      this.stream.end(() => resolve());
      this.stream.on('error', reject);
    });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(this.txtPath, `${finals.join(' ')}\n`, 'utf8');
    return { jsonlPath: this.jsonlPath, txtPath: this.txtPath };
  }
}
```

- [ ] **Step 2: Написать адаптер Deepgram**

Существующий `DeepgramSTT` уже настроен на linear16 / 16 кГц / 1 канал (`src/stt/deepgram.ts:101-112`) — как раз наш формат, поэтому адаптер только переупаковывает callback в `SmokeEvent`.

```ts
// Эталон для сравнения: существующий прод-провайдер Deepgram, без изменений в src/.

import { DeepgramSTT } from '../../../src/stt/deepgram.js';
import type { SmokeEvent, SmokeRunner } from '../types.js';

export function createDeepgramRunner(language: string): SmokeRunner {
  const stt = new DeepgramSTT();

  return {
    async start(onEvent) {
      await stt.initialize(language, (result) => {
        onEvent({
          isFinal: result.isFinal,
          text: result.text,
          audioPosSec: result.startSec,
          durationSec: result.durationSec,
        });
      });
    },

    async send(chunk) {
      await stt.processAudio(chunk, 'pcm');
    },

    async finish(trailingMs) {
      await stt.finalize();
      // Хвостовые финалы приходят уже после finish() — даём им дойти до callback.
      await new Promise((resolve) => setTimeout(resolve, trailingMs));
      await stt.destroy();
    },
  } satisfies SmokeRunner;
}
```

- [ ] **Step 3: Написать `run.ts`**

```ts
// CLI смок-прогона. Пример:
//   npm run stt:smoke -- --file recordings/recording-62a7123a-...wav --provider deepgram --seconds 30

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, basename, join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
// .env читаем до всего остального: провайдеры берут ключи из process.env внутри своих функций.
config({ path: resolve(here, '../../.env') });

const { parseWav, chunkPcm, bytesPerChunk, feedRealtime } = await import('./feed.js');
const { EventSink } = await import('./sink.js');
const { createDeepgramRunner } = await import('./providers/deepgram.js');
type ProviderName = import('./types.js').ProviderName;
type SmokeRunner = import('./types.js').SmokeRunner;

const CHUNK_MS = 100;
const TRAILING_MS = 5000;

interface Args {
  file: string;
  provider: ProviderName;
  language: string;
  seconds: number | null;
  outDir: string;
  raw: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const file = get('file');
  const provider = (get('provider') ?? 'deepgram') as ProviderName;
  if (!file) throw new Error('Usage: --file <wav> --provider deepgram|nemotron|salute [--language ru] [--seconds N] [--out dir] [--raw]');
  if (!['deepgram', 'nemotron', 'salute'].includes(provider)) throw new Error(`Unknown provider: ${provider}`);

  const seconds = get('seconds');
  return {
    file,
    provider,
    language: get('language') ?? 'ru',
    seconds: seconds ? Number(seconds) : null,
    outDir: get('out') ?? join(here, 'out'),
    raw: argv.includes('--raw'),
  };
}

async function createRunner(args: Args): Promise<SmokeRunner> {
  if (args.provider === 'deepgram') return createDeepgramRunner(args.language);
  if (args.provider === 'nemotron') {
    const { createNemotronRunner } = await import('./providers/nemotron.js');
    return createNemotronRunner(args.language, { raw: args.raw, outDir: args.outDir });
  }
  const { createSaluteRunner } = await import('./providers/salute.js');
  return createSaluteRunner(args.language, { raw: args.raw, outDir: args.outDir });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const wav = parseWav(await readFile(args.file));
  if (wav.sampleRate !== 16000 || wav.channels !== 1) {
    throw new Error(`Expected 16 kHz mono, got ${wav.sampleRate} Hz / ${wav.channels}ch`);
  }

  const perChunk = bytesPerChunk(wav, CHUNK_MS);
  let chunks = chunkPcm(wav.data, perChunk);
  if (args.seconds) chunks = chunks.slice(0, Math.ceil((args.seconds * 1000) / CHUNK_MS));

  const audioSec = (chunks.reduce((sum, c) => sum + c.length, 0) / (wav.sampleRate * 2));
  const name = basename(args.file).replace(/\.wav$/i, '');
  const sink = new EventSink(args.outDir, name, args.provider);
  const runner = await createRunner(args);

  const startedAt = Date.now();
  await runner.start((event) => sink.add({ ...event, msFromStart: Date.now() - startedAt }));
  await feedRealtime(chunks, CHUNK_MS, (chunk) => runner.send(chunk));
  await runner.finish(TRAILING_MS);

  const { jsonlPath, txtPath } = await sink.close();
  const finals = sink.events.filter((e) => e.isFinal).length;
  const firstEvent = sink.events[0]?.msFromStart;
  console.log(`provider=${args.provider} audio=${audioSec.toFixed(1)}s events=${sink.events.length} finals=${finals} first=${firstEvent ?? 'none'}ms`);
  console.log(`  ${jsonlPath}\n  ${txtPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 4: Прописать npm-скрипт и игнор**

В `packages/backend/package.json` в `scripts` добавить:

```json
"stt:smoke": "tsx scripts/stt-smoke/run.ts",
```

В корневой `.gitignore` — в секцию «Recordings» добавить:

```
packages/backend/scripts/stt-smoke/out/
```

- [ ] **Step 5: Проверить, что прогон Deepgram работает**

Run:
```bash
cd packages/backend && npm run stt:smoke -- \
  --file recordings/recording-62a7123a-2026-02-18T08-04-37-722Z.wav \
  --provider deepgram --seconds 30
```
Expected: строка вида `provider=deepgram audio=30.0s events=N finals=M first=~1000ms` с `finals > 0`, и в `scripts/stt-smoke/out/` появились `.jsonl` и `.txt` с осмысленным русским текстом.

Если `finals=0` — проверить `DEEPGRAM_API_KEY` в `packages/backend/.env`; это блокер, дальше не идти.

- [ ] **Step 6: Type-check и тесты**

Run: `cd packages/backend && npm run type-check:scripts && npx vitest run scripts/stt-smoke`
Expected: без ошибок, тесты Задачи 1 по-прежнему зелёные.

- [ ] **Step 7: Написать README скрипта**

Создать `packages/backend/scripts/stt-smoke/README.md`: назначение (смок по спеке `docs/superpowers/specs/2026-08-06-cloud-stt-smoke-design.md`), список env-переменных (`DEEPGRAM_API_KEY`, `TOGETHER_API_KEY`, `SALUTE_CLIENT_ID`, `SALUTE_CLIENT_SECRET`), примеры команд для трёх провайдеров, предупреждение «`out/` не коммитить — там транскрипты реальных звонков», и пустой раздел «Findings» для результатов прогонов.

- [ ] **Step 8: Коммит**

```bash
git add packages/backend/scripts/stt-smoke/sink.ts \
        packages/backend/scripts/stt-smoke/providers/deepgram.ts \
        packages/backend/scripts/stt-smoke/run.ts \
        packages/backend/scripts/stt-smoke/README.md \
        packages/backend/package.json .gitignore
git commit -m "feat(smoke): CLI смок-прогона и эталон на Deepgram nova-3"
```

---

### Task 3: Адаптер Nemotron 3.5 (Together AI)

Точные имена серверных событий Together в открытых источниках не подтверждены, поэтому задача устроена в два приёма: сначала **разведка** — дампим сырые кадры на 20 секундах аудио, потом маппинг по факту увиденного. Не изобретать имена событий из головы.

**Files:**
- Create: `packages/backend/scripts/stt-smoke/providers/nemotron.ts`
- Modify: `packages/backend/package.json` (devDependency `ws`)
- Modify: `packages/backend/scripts/stt-smoke/README.md` (раздел Findings)

**Interfaces:**
- Consumes: `SmokeRunner`, `SmokeEvent` из `../types.js`.
- Produces: `function createNemotronRunner(language: string, opts: { raw: boolean; outDir: string }): SmokeRunner`

**Известное о протоколе (гипотеза для разведки):**
- URL: `wss://api.together.ai/v1/realtime?model=nvidia/nemotron-3.5-asr-streaming-0.6b&input_audio_format=pcm16`
- Заголовок: `Authorization: Bearer ${TOGETHER_API_KEY}`
- Клиентское событие с аудио: `{"type":"input_audio_buffer.append","audio":"<base64 pcm16>"}`
- Серверные события — в стиле OpenAI Realtime; ожидаются дельты и «завершённые» транскрипты, точные `type` **выясняются на шаге разведки**.

- [ ] **Step 1: Установить `ws` как явную зависимость**

`ws` сейчас доступен только транзитивно через `@fastify/websocket` — на это опираться нельзя.

Run: `cd packages/backend && npm i -D ws@^8.18.3`
Expected: в `devDependencies` появился `ws`; `@types/ws` уже есть.

- [ ] **Step 2: Написать разведочную версию адаптера — только дамп кадров**

```ts
// Адаптер Nemotron 3.5 ASR Streaming через Together AI Realtime API.
// Первый этап: собираем сырые кадры, чтобы узнать реальные имена серверных событий.

import { createWriteStream } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { SmokeRunner } from '../types.js';

const MODEL = 'nvidia/nemotron-3.5-asr-streaming-0.6b';

function getApiKey(): string {
  const key = process.env.TOGETHER_API_KEY;
  if (!key) throw new Error('TOGETHER_API_KEY environment variable is not set');
  return key;
}

export function createNemotronRunner(language: string, opts: { raw: boolean; outDir: string }): SmokeRunner {
  let socket: WebSocket | null = null;
  let rawStream: ReturnType<typeof createWriteStream> | null = null;

  return {
    async start(_onEvent) {
      const url = `wss://api.together.ai/v1/realtime?model=${encodeURIComponent(MODEL)}&input_audio_format=pcm16`;
      socket = new WebSocket(url, { headers: { Authorization: `Bearer ${getApiKey()}` } });

      if (opts.raw) {
        mkdirSync(opts.outDir, { recursive: true });
        rawStream = createWriteStream(join(opts.outDir, 'nemotron-raw.jsonl'), { encoding: 'utf8' });
      }

      await new Promise<void>((resolve, reject) => {
        socket!.once('open', () => resolve());
        socket!.once('error', (err) => reject(new Error(`Together WS failed: ${err.message}`)));
      });

      socket.on('message', (data) => {
        const text = data.toString();
        rawStream?.write(`${text}\n`);
        console.log(`[nemotron raw] ${text.slice(0, 400)}`);
      });
    },

    send(chunk) {
      socket?.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: chunk.toString('base64') }));
    },

    async finish(trailingMs) {
      await new Promise((resolve) => setTimeout(resolve, trailingMs));
      rawStream?.end();
      socket?.close();
      socket = null;
    },
  } satisfies SmokeRunner;
}
```

- [ ] **Step 3: Разведочный прогон на 20 секундах**

Run:
```bash
cd packages/backend && npm run stt:smoke -- \
  --file recordings/recording-62a7123a-2026-02-18T08-04-37-722Z.wav \
  --provider nemotron --seconds 20 --raw
```
Expected: соединение открывается и в консоль/`out/nemotron-raw.jsonl` льются кадры с русским текстом.

Три возможных исхода, все обрабатываются здесь же:
1. **Кадры с транскриптом есть** → выписать в README точные `type` и путь к тексту (например `delta` / `transcript`), идти к шагу 4.
2. **Ошибка про формат аудио или параметр** (`invalid input_audio_format`, требуется `transcription_session.update` и т. п.) → добавить первое конфигурационное сообщение по тексту ошибки сервера и повторить шаг 3.
3. **Русский не распознаётся / сервер требует язык** → добавить `language` в конфигурационное сообщение или в query (`&language=ru`), повторить. Если модель в стриминге отдаёт только английский — это **результат смока**: записать в README, что мультиязычность 3.5 в стриминге у Together недоступна, и остановиться на этой задаче.

- [ ] **Step 4: Заменить дамп на маппинг событий**

Дополнить `providers/nemotron.ts`: вместо `console.log` разобрать кадр и вызвать `onEvent`. Точные имена подставить из шага 3; функция-маппер отдельная, чтобы её было видно:

```ts
/** Превращает кадр Together в наше событие. Имена полей — по факту разведки (шаг 3). */
function toSmokeEvent(frame: unknown): { isFinal: boolean; text: string } | null {
  const f = frame as { type?: string; delta?: string; transcript?: string; text?: string };
  if (!f?.type) return null;
  const text = f.transcript ?? f.delta ?? f.text ?? '';
  if (!text.trim()) return null;
  // Финалом считаем «completed/final» кадры, остальное — партиалы.
  const isFinal = /completed|final|done/i.test(f.type);
  return { isFinal, text };
}
```

и в обработчике `message`:

```ts
socket.on('message', (data) => {
  const text = data.toString();
  rawStream?.write(`${text}\n`);
  let frame: unknown;
  try { frame = JSON.parse(text); } catch { return; }
  const event = toSmokeEvent(frame);
  if (event) onEvent(event);
});
```

Сигнатуру `start` поправить: `_onEvent` → `onEvent`.

- [ ] **Step 5: Полный прогон на короткой записи**

Run:
```bash
cd packages/backend && npm run stt:smoke -- \
  --file recordings/recording-62a7123a-2026-02-18T08-04-37-722Z.wav \
  --provider nemotron
```
Expected: `finals > 0`, в `.txt` — читаемый русский текст всей записи.

- [ ] **Step 6: Прогон на длинной записи (стабильность сессии)**

Run:
```bash
cd packages/backend && npm run stt:smoke -- \
  --file recordings/recording-f11102c6-2026-02-18T08-38-22-258Z.wav \
  --provider nemotron
```
Expected: 6:14 без разрыва соединения; события идут до конца (последний `msFromStart` ≈ 374 000). Разрыв середине — записать в README как найденное ограничение.

Тот же прогон повторить для эталона: `--provider deepgram` на этой же записи (нужен для отчёта в Задаче 4).

- [ ] **Step 7: Type-check и тесты**

Run: `cd packages/backend && npm run type-check:scripts && npx vitest run scripts/stt-smoke`
Expected: без ошибок.

- [ ] **Step 8: Записать findings и закоммитить**

В `README.md` в раздел Findings: подтверждённые имена серверных событий, потребовалась ли конфигурация сессии, распознаётся ли русский, поведение на 6-минутной сессии.

```bash
git add packages/backend/scripts/stt-smoke/providers/nemotron.ts \
        packages/backend/scripts/stt-smoke/README.md \
        packages/backend/package.json package-lock.json
git commit -m "feat(smoke): адаптер Nemotron 3.5 ASR Streaming через Together AI"
```

---

### Task 4: Отчёт — метрики, сравнение, стоимость

Считает из JSONL то, ради чего всё делалось. Здесь чистые функции, поэтому TDD в полном виде.

**Files:**
- Create: `packages/backend/scripts/stt-smoke/report.ts`
- Test: `packages/backend/scripts/stt-smoke/report.test.ts`
- Modify: `packages/backend/package.json` (скрипт `stt:report`)

**Interfaces:**
- Consumes: `SmokeEvent`, `ProviderName` из `./types.js`.
- Produces:
  - `function timeToFirstEventMs(events: SmokeEvent[]): number | null`
  - `function finalCount(events: SmokeEvent[]): number`
  - `function medianFinalLagMs(events: SmokeEvent[]): number | null`
  - `function flatTranscript(events: SmokeEvent[]): string`
  - `function costUsd(audioSec: number, provider: ProviderName): number`
  - `function buildReport(runs: Array<{ provider: ProviderName; audioSec: number; events: SmokeEvent[] }>): string`
  - CLI: `npm run stt:report -- --out <dir> --file <basename>`

- [ ] **Step 1: Написать падающие тесты `report.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { timeToFirstEventMs, finalCount, medianFinalLagMs, flatTranscript, costUsd, buildReport } from './report.js';
import type { SmokeEvent } from './types.js';

const ev = (e: Partial<SmokeEvent>): SmokeEvent => ({ msFromStart: 0, isFinal: false, text: 'x', ...e });

describe('timeToFirstEventMs', () => {
  it('берёт время самого раннего события', () => {
    expect(timeToFirstEventMs([ev({ msFromStart: 900 }), ev({ msFromStart: 400 })])).toBe(400);
  });

  it('на пустом прогоне возвращает null', () => {
    expect(timeToFirstEventMs([])).toBeNull();
  });
});

describe('finalCount', () => {
  it('считает только финалы', () => {
    expect(finalCount([ev({ isFinal: true }), ev({ isFinal: false }), ev({ isFinal: true })])).toBe(2);
  });
});

describe('medianFinalLagMs', () => {
  it('меряет отставание финала от конца его сегмента в аудио', () => {
    // Сегмент кончился на 2.0 с аудио, финал пришёл на 3200 мс → отставание 1200 мс.
    const events = [ev({ isFinal: true, msFromStart: 3200, audioPosSec: 1, durationSec: 1 })];
    expect(medianFinalLagMs(events)).toBe(1200);
  });

  it('берёт медиану, а не среднее', () => {
    const events = [
      ev({ isFinal: true, msFromStart: 1500, audioPosSec: 0, durationSec: 1 }),
      ev({ isFinal: true, msFromStart: 3000, audioPosSec: 1, durationSec: 1 }),
      ev({ isFinal: true, msFromStart: 60000, audioPosSec: 2, durationSec: 1 }),
    ];
    expect(medianFinalLagMs(events)).toBe(1000);
  });

  it('возвращает null, если провайдер не сообщает позиции', () => {
    expect(medianFinalLagMs([ev({ isFinal: true, msFromStart: 1000 })])).toBeNull();
  });
});

describe('flatTranscript', () => {
  it('склеивает только финалы по порядку', () => {
    const events = [
      ev({ isFinal: false, text: 'привет ми' }),
      ev({ isFinal: true, text: 'привет мир' }),
      ev({ isFinal: true, text: 'как дела' }),
    ];
    expect(flatTranscript(events)).toBe('привет мир как дела');
  });
});

describe('costUsd', () => {
  it('считает по минутам аудио', () => {
    expect(costUsd(600, 'deepgram')).toBeCloseTo(0.077, 3); // 10 мин × $0.0077
  });

  it('nemotron дешевле deepgram на том же аудио', () => {
    expect(costUsd(600, 'nemotron')).toBeLessThan(costUsd(600, 'deepgram'));
  });

  it('salute дороже deepgram на том же аудио', () => {
    expect(costUsd(600, 'salute')).toBeGreaterThan(costUsd(600, 'deepgram'));
  });
});

describe('buildReport', () => {
  it('кладёт провайдеров в таблицу и печатает транскрипты', () => {
    const md = buildReport([
      { provider: 'deepgram', audioSec: 120, events: [ev({ isFinal: true, msFromStart: 1000, text: 'эталон' })] },
      { provider: 'nemotron', audioSec: 120, events: [ev({ isFinal: true, msFromStart: 800, text: 'кандидат' })] },
    ]);
    expect(md).toContain('deepgram');
    expect(md).toContain('nemotron');
    expect(md).toContain('эталон');
    expect(md).toContain('кандидат');
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd packages/backend && npx vitest run scripts/stt-smoke/report.test.ts`
Expected: FAIL — `Failed to resolve import "./report.js"`.

- [ ] **Step 3: Реализовать `report.ts`**

```ts
// Метрики и сборка отчёта по логам прогонов. Всё — чистые функции над SmokeEvent[].

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
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd packages/backend && npx vitest run scripts/stt-smoke/report.test.ts`
Expected: PASS, 11 тестов.

- [ ] **Step 5: Добавить CLI отчёта**

Дописать в конец `report.ts` (запускается только при прямом вызове файла, чтобы тесты не дёргали fs):

```ts
// --- CLI ---
// npm run stt:report -- --file recording-62a7123a-2026-02-18T08-04-37-722Z --out scripts/stt-smoke/out
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*?(scripts\/.*)$/, '$1'))) {
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
    const audioSec = Math.max(...events.map((e) => e.msFromStart)) / 1000;
    runs.push({ provider, audioSec, events });
  }

  const path = join(outDir, `${base}-report.md`);
  await writeFile(path, buildReport(runs), 'utf8');
  console.log(`Отчёт: ${path}`);
}
```

В `packages/backend/package.json` добавить:

```json
"stt:report": "tsx scripts/stt-smoke/report.ts",
```

- [ ] **Step 6: Собрать отчёт по реальным прогонам**

Run:
```bash
cd packages/backend && npm run stt:report -- --file recording-62a7123a-2026-02-18T08-04-37-722Z
```
Expected: создан `scripts/stt-smoke/out/<basename>-report.md` с таблицей по deepgram и nemotron и двумя транскриптами. Прочитать глазами и сравнить качество русского.

- [ ] **Step 7: Type-check и все тесты**

Run: `cd packages/backend && npm run type-check:scripts && npm test`
Expected: без ошибок, все тесты пакета зелёные.

- [ ] **Step 8: Коммит**

```bash
git add packages/backend/scripts/stt-smoke/report.ts \
        packages/backend/scripts/stt-smoke/report.test.ts \
        packages/backend/package.json
git commit -m "feat(smoke): отчёт по прогонам — латентность, финалы, стоимость"
```

---

### Task 5: Адаптер GigaAM через SaluteSpeech

Выполняется **после** того как Nemotron доведён до конца. Действует правило остановки из Global Constraints: одна попытка обхода на TLS и одна на proto, дальше — фиксация findings и стоп.

**Files:**
- Create: `packages/backend/scripts/stt-smoke/providers/salute.ts`
- Create: `packages/backend/scripts/stt-smoke/proto/` (скачанные `.proto` Сбера)
- Modify: `packages/backend/package.json` (devDependencies `@grpc/grpc-js`, `@grpc/proto-loader`)
- Modify: `packages/backend/scripts/stt-smoke/README.md` (доступы, TLS-рецепт, findings)

**Interfaces:**
- Consumes: `SmokeRunner` из `../types.js`.
- Produces: `function createSaluteRunner(language: string, opts: { raw: boolean; outDir: string }): SmokeRunner`

**Известное:**
- OAuth: `POST https://ngw.devices.sberbank.ru:9443/api/v2/oauth`, `Authorization: Basic base64(client_id:client_secret)`, `RqUID: <uuid>`, `Content-Type: application/x-www-form-urlencoded`, тело `scope=SALUTE_SPEECH_PERS`. Токен живёт 30 минут — на наши записи хватает одного, refresh не пишем.
- gRPC: хост `smartspeech.sber.ru:443`, метод `Recognize` (двунаправленный стрим), первое сообщение — `RecognitionOptions` (PCM_S16LE, 16000, `ru-RU`, промежуточные гипотезы включены).
- Точные имена пакета/сервиса/полей **берутся из скачанного proto**, а не из головы.

- [ ] **Step 1: Установить gRPC-зависимости явно**

Сейчас `@grpc/grpc-js` и `@grpc/proto-loader` присутствуют только транзитивно (через `@yandex-cloud/nodejs-sdk`).

Run: `cd packages/backend && npm i -D @grpc/grpc-js @grpc/proto-loader`
Expected: обе появились в `devDependencies`.

- [ ] **Step 2: Достать proto-файлы и корневой сертификат**

Взять `.proto` для распознавания из документации SaluteSpeech (`developers.sber.ru/docs/ru/salutespeech/api/grpc/recognition-stream`) и положить в `packages/backend/scripts/stt-smoke/proto/`. Скачать корневой сертификат Минцифры (`russian_trusted_root_ca.pem`) туда же.

Прочитать proto и **выписать в README** фактические: имя пакета, имя сервиса, имя метода, имя типа опций и названия полей формата/частоты/языка/гипотез. Дальнейший код пишется по этим именам.

Если proto недоступны — сделать одну попытку найти их в публичном репозитории `salute-developers`. Если и это не вышло: записать в README «SaluteSpeech заблокирован: нет proto», закоммитить README, остановиться и доложить. Задача считается отложенной, а не проваленной.

- [ ] **Step 3: Написать получение токена и проверить его отдельно**

```ts
// SaluteSpeech (семейство GigaAM): OAuth + двунаправленный gRPC-стрим распознавания.

import { randomUUID } from 'node:crypto';

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.SALUTE_CLIENT_ID;
  const clientSecret = process.env.SALUTE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('SALUTE_CLIENT_ID / SALUTE_CLIENT_SECRET are not set');
  }
  return { clientId, clientSecret };
}

/** Токен живёт 30 минут — на одну запись хватает, поэтому без кеша и refresh. */
export async function fetchAccessToken(): Promise<string> {
  const { clientId, clientSecret } = getCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      RqUID: randomUUID(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'scope=SALUTE_SPEECH_PERS',
  });

  if (!response.ok) {
    throw new Error(`SaluteSpeech OAuth failed: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error('SaluteSpeech OAuth returned no access_token');
  return payload.access_token;
}
```

Проверить изолированно:

Run:
```bash
cd packages/backend && npx tsx -e "
  const { config } = await import('dotenv');
  config({ path: '.env' });
  const { fetchAccessToken } = await import('./scripts/stt-smoke/providers/salute.ts');
  console.log((await fetchAccessToken()).slice(0, 24) + '...');
"
```
Expected: печатается начало токена.

Если падает с `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `self-signed certificate in certificate chain` — это и есть ожидаемая TLS-проблема. Одна попытка обхода:

```bash
NODE_EXTRA_CA_CERTS=scripts/stt-smoke/proto/russian_trusted_root_ca.pem npx tsx -e "...тот же код..."
```

Если и с сертификатом не проходит — записать в README «SaluteSpeech заблокирован: TLS», закоммитить, остановиться, доложить.

- [ ] **Step 4: Написать gRPC-стрим по именам из proto**

Дописать в `providers/salute.ts` (имена `PACKAGE_SERVICE`, полей опций — подставить фактические из шага 2):

```ts
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { SmokeRunner } from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = join(here, '..', 'proto');

export function createSaluteRunner(language: string, opts: { raw: boolean; outDir: string }): SmokeRunner {
  let call: grpc.ClientDuplexStream<unknown, unknown> | null = null;
  let client: grpc.Client | null = null;
  let rawStream: ReturnType<typeof createWriteStream> | null = null;

  return {
    async start(onEvent) {
      const token = await fetchAccessToken();

      // Имя файла и путь к сервису — из фактического proto (шаг 2).
      const definition = protoLoader.loadSync(join(PROTO_DIR, 'recognition.proto'), {
        keepCase: true, longs: String, enums: String, defaults: true, oneofs: true, includeDirs: [PROTO_DIR],
      });
      const pkg = grpc.loadPackageDefinition(definition) as any;
      const ServiceCtor = pkg.smartspeech.recognition.v1.SmartSpeech;

      const ssl = grpc.credentials.createSsl(readFileSync(join(PROTO_DIR, 'russian_trusted_root_ca.pem')));
      const callCreds = grpc.credentials.createFromMetadataGenerator((_params, cb) => {
        const meta = new grpc.Metadata();
        meta.set('authorization', `Bearer ${token}`);
        cb(null, meta);
      });

      client = new ServiceCtor('smartspeech.sber.ru:443', grpc.credentials.combineChannelCredentials(ssl, callCreds));
      call = (client as any).Recognize();

      if (opts.raw) {
        mkdirSync(opts.outDir, { recursive: true });
        rawStream = createWriteStream(join(opts.outDir, 'salute-raw.jsonl'), { encoding: 'utf8' });
      }

      // Первое сообщение — опции распознавания (имена полей из proto).
      call!.write({
        options: {
          audio_encoding: 'PCM_S16LE',
          sample_rate: 16000,
          language: language === 'ru' ? 'ru-RU' : language,
          hypotheses_count: 1,
          enable_partial_results: true,
        },
      });

      call!.on('data', (message: any) => {
        rawStream?.write(`${JSON.stringify(message)}\n`);
        const text: string = message?.transcript?.results?.[0]?.text ?? message?.results?.[0]?.text ?? '';
        if (!text.trim()) return;
        onEvent({ isFinal: message?.eou === true || message?.is_final === true, text });
      });

      call!.on('error', (err: Error) => console.error(`[salute] ${err.message}`));
    },

    send(chunk) {
      call?.write({ audio_content: chunk });
    },

    async finish(trailingMs) {
      call?.end();
      await new Promise((resolve) => setTimeout(resolve, trailingMs));
      rawStream?.end();
      client?.close();
      call = null;
      client = null;
    },
  } satisfies SmokeRunner;
}
```

- [ ] **Step 5: Разведочный прогон на 20 секундах**

Run:
```bash
cd packages/backend && NODE_EXTRA_CA_CERTS=scripts/stt-smoke/proto/russian_trusted_root_ca.pem \
  npm run stt:smoke -- --file recordings/recording-62a7123a-2026-02-18T08-04-37-722Z.wav \
  --provider salute --seconds 20 --raw
```
Expected: в `out/salute-raw.jsonl` приходят сообщения с русским текстом. Если структура ответа отличается — поправить путь к тексту и признак финала в обработчике `data` по факту увиденного и повторить.

- [ ] **Step 6: Полные прогоны и отчёт на три провайдера**

Run:
```bash
cd packages/backend
NODE_EXTRA_CA_CERTS=scripts/stt-smoke/proto/russian_trusted_root_ca.pem npm run stt:smoke -- \
  --file recordings/recording-62a7123a-2026-02-18T08-04-37-722Z.wav --provider salute
npm run stt:report -- --file recording-62a7123a-2026-02-18T08-04-37-722Z
```
Expected: в отчёте три строки (deepgram, nemotron, salute) и три транскрипта рядом. Учесть бесплатный лимит Freemium — 100 минут в месяц.

- [ ] **Step 7: Type-check и все тесты**

Run: `cd packages/backend && npm run type-check:scripts && npm test`
Expected: без ошибок.

- [ ] **Step 8: Коммит**

`proto/` коммитим (это входные данные скрипта), сертификат — тоже (публичный корневой CA). `out/` — нет.

```bash
git add packages/backend/scripts/stt-smoke/providers/salute.ts \
        packages/backend/scripts/stt-smoke/proto \
        packages/backend/scripts/stt-smoke/README.md \
        packages/backend/package.json package-lock.json
git commit -m "feat(smoke): адаптер GigaAM через SaluteSpeech (gRPC-стрим)"
```

---

### Task 6: Зафиксировать результат в доках

Правило репо: доки — зеркало реальности. Смок бессмысленен, если вывод остался в `out/`.

**Files:**
- Modify: `docs/decisions/0005-stt-strategy-self-hosted-ru.md`
- Modify: `docs/backlog.md:59` (пункт LS-13)
- Modify: `docs/KNOWLEDGE.md`
- Modify: `docs/PROGRESS.md`

- [ ] **Step 1: Дописать в ADR-0005 раздел «Проверка облачных вариантов (2026-08)»**

Указать: что оба семейства доступны как облачные API без GPU (это меняет посылку ADR — GPU больше не обязателен для проверки), фактические результаты по качеству русского, латентности, стабильности и цене, и какой из вариантов выглядит рабочим. Статус ADR не менять без отдельного решения — это дополнение, а не новое решение.

- [ ] **Step 2: Обновить LS-13 в `docs/backlog.md`**

В пункт LS-13 добавить, что смок-проверка выполнена, со ссылкой на спеку и на README скрипта; перечислить, какие из открытых вопросов закрыты, а какие остались (WER с эталоном, per-track).

- [ ] **Step 3: Добавить грабли в `docs/KNOWLEDGE.md`**

Всё, что стоило времени: TLS-сертификат Минцифры для API Сбера, реальные имена событий Together, потребовалась ли конфигурация сессии, лимит Freemium 100 мин/мес.

- [ ] **Step 4: Обновить курсор в `docs/PROGRESS.md`**

- [ ] **Step 5: Перевести карточку на доске в «На проверке»** с кратким комментарием что сделано (механика — скилл `task-board`).

- [ ] **Step 6: Коммит**

```bash
git add docs/decisions/0005-stt-strategy-self-hosted-ru.md docs/backlog.md docs/KNOWLEDGE.md docs/PROGRESS.md
git commit -m "docs: результаты смок-проверки облачных STT (LS-13)"
```

---

## Self-Review

**Покрытие спеки:** все шесть модулей из таблицы спеки разложены по задачам (`feed.ts` → Task 1, `sink.ts`/`run.ts`/`providers/deepgram.ts` → Task 2, `providers/nemotron.ts` → Task 3, `report.ts` → Task 4, `providers/salute.ts` → Task 5, README — Tasks 2/3/5). Обе записи из спеки используются: короткая в Tasks 2/3/5, длинная в Task 3 Step 6 (стабильность сессии). Все пять рисков спеки имеют место в плане: TLS (Task 5 Step 3), proto (Task 5 Step 2), RU в стриминге Nemotron (Task 3 Step 3, исход 3), 30-минутный токен (Task 5 Step 3, комментарий в коде), секреты и `out/` (Global Constraints + Task 2 Step 4). Способ оценки из спеки закрыт Task 4: качество — транскрипты рядом, латентность — `timeToFirstEventMs`/`medianFinalLagMs`, стабильность — Task 3 Step 6, стоимость — `costUsd`. Список «чего не делаем» нигде не нарушен. Единственное добавление к спеке — Task 6 (фиксация в доках): требование репо, а не расширение объёма.

**Заглушки:** не найдено — каждый шаг с кодом содержит код, каждая проверка содержит команду и ожидаемый результат. Места, где протокол внешнего API не подтверждён (имена событий Together, поля proto Сбера), оформлены как явные шаги разведки с командой, ожидаемым выводом и разбором исходов — а не как «разобраться по ходу».

**Согласованность типов:** `SmokeEvent`/`SmokeRunner`/`ProviderName` объявлены в Task 1 Step 1 и используются в Tasks 2–5 в том же виде; `msFromStart` проставляет `run.ts`, поэтому провайдеры отдают `Omit<SmokeEvent, 'msFromStart'>` — совпадает с сигнатурой `start` во всех трёх адаптерах. Имена `createDeepgramRunner`/`createNemotronRunner`/`createSaluteRunner` совпадают с вызовами в `run.ts`. `bytesPerChunk`/`chunkPcm`/`feedRealtime` вызываются в Task 2 Step 3 ровно с теми подписями, что определены в Task 1.
