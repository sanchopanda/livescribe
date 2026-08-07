import { describe, it, expect } from 'vitest';
import { parseWav, chunkPcm, bytesPerChunk, wavDurationMs, feedRealtime } from './feed.js';

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
    expect(bytesPerChunk({ sampleRate: 16000, channels: 1, bitsPerSample: 16 }, 100)).toBe(3200);
  });
});

describe('wavDurationMs', () => {
  it('считает длительность по размеру data, а не по приближению из событий', () => {
    // 1 секунда моно 16 кГц s16le = 32000 байт.
    expect(wavDurationMs({ data: Buffer.alloc(32000), sampleRate: 16000, channels: 1, bitsPerSample: 16 })).toBeCloseTo(1000, 3);
  });

  it('учитывает число каналов', () => {
    // Те же 32000 байт, но стерео — вдвое короче по времени.
    expect(wavDurationMs({ data: Buffer.alloc(32000), sampleRate: 16000, channels: 2, bitsPerSample: 16 })).toBeCloseTo(500, 3);
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
