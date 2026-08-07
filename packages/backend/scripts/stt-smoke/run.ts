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
  if (!file) throw new Error('Usage: --file <wav> --provider deepgram|nemotron|whisper|salute [--language ru] [--seconds N] [--out dir] [--raw]');
  if (!['deepgram', 'nemotron', 'whisper', 'salute'].includes(provider)) throw new Error(`Unknown provider: ${provider}`);

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
  if (args.provider === 'whisper') {
    // Whisper large-v3 отдаётся через тот же Together Realtime эндпоинт, что и Nemotron —
    // общая фабрика createTogetherRunner живёт в providers/nemotron.ts (см. комментарий там).
    const { createWhisperRunner } = await import('./providers/nemotron.js');
    return createWhisperRunner(args.language, { raw: args.raw, outDir: args.outDir });
  }
  // SaluteSpeech снят из объёма смока (облачного доступа к GigaAM для физлица нет) — файла providers/salute.ts нет.
  throw new Error(`Провайдер "${args.provider}" не реализован: облачного доступа к GigaAM для физлица нет, решение — docs/decisions/0005-stt-strategy-self-hosted-ru.md`);
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

  const { jsonlPath, txtPath, metaPath } = await sink.close(audioSec);
  const finals = sink.events.filter((e) => e.isFinal).length;
  const firstEvent = sink.events[0]?.msFromStart;
  console.log(`provider=${args.provider} audio=${audioSec.toFixed(1)}s events=${sink.events.length} finals=${finals} first=${firstEvent ?? 'none'}ms`);
  console.log(`  ${jsonlPath}\n  ${txtPath}\n  ${metaPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
