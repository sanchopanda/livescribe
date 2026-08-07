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

/** Фактическая длительность аудио в мс — по размеру data-чанка, а не по приближению из событий. */
export function wavDurationMs(wav: Pick<WavPcm, 'data' | 'sampleRate' | 'channels' | 'bitsPerSample'>): number {
  const bytesPerSample = (wav.bitsPerSample / 8) * wav.channels;
  return (wav.data.length / bytesPerSample / wav.sampleRate) * 1000;
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
