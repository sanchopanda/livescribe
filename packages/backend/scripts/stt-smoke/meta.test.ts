import { describe, it, expect } from 'vitest';
import { metaFileName, metaPath, parseMetaAudioSec, resolveAudioSec } from './meta.js';

describe('metaFileName', () => {
  it('склеивает basename и провайдера по тому же шаблону, что jsonl/txt', () => {
    expect(metaFileName('recording-1', 'deepgram')).toBe('recording-1-deepgram.meta.json');
  });
});

describe('metaPath', () => {
  it('добавляет outDir спереди', () => {
    expect(metaPath('out', 'recording-1', 'nemotron')).toBe('out/recording-1-nemotron.meta.json');
  });
});

describe('parseMetaAudioSec', () => {
  it('читает audioSec из валидного JSON', () => {
    expect(parseMetaAudioSec('{"audioSec": 30.5}')).toBe(30.5);
  });

  it('битый JSON — null', () => {
    expect(parseMetaAudioSec('не json')).toBeNull();
  });

  it('отсутствующее поле — null', () => {
    expect(parseMetaAudioSec('{}')).toBeNull();
  });

  it('audioSec не число — null', () => {
    expect(parseMetaAudioSec('{"audioSec": "30"}')).toBeNull();
  });

  it('audioSec <= 0 — null (не может быть валидной длительностью)', () => {
    expect(parseMetaAudioSec('{"audioSec": 0}')).toBeNull();
    expect(parseMetaAudioSec('{"audioSec": -5}')).toBeNull();
  });
});

describe('resolveAudioSec', () => {
  it('метафайла нет (null) — падает обратно на длину WAV', () => {
    expect(resolveAudioSec(null, 374.5)).toBe(374.5);
  });

  it('метафайл есть и валиден — берёт его значение, а не длину WAV', () => {
    // Ровно случай из отчёта: --seconds 30 по 6-минутной записи должен дать 30, а не 374.5.
    expect(resolveAudioSec('{"audioSec": 30}', 374.5)).toBe(30);
  });

  it('метафайл битый — падает обратно на длину WAV', () => {
    expect(resolveAudioSec('не json', 374.5)).toBe(374.5);
  });
});
