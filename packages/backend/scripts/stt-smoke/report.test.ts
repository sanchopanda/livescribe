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

  it('округляет результат при нецелых durationSec (реальные данные Deepgram)', () => {
    // Реальные данные из Deepgram приходят с нецелыми значениями: 2.1899996, 3.5900002
    // Результат должен быть целым числом (не 13311.999899999999)
    const events = [
      ev({ isFinal: true, msFromStart: 5000, audioPosSec: 1, durationSec: 2.1899996 }),
    ];
    const result = medianFinalLagMs(events);
    expect(result).not.toBeNull();
    expect(Number.isInteger(result!)).toBe(true);
    expect(result).toBeCloseTo(1810, 1); // 5000 - (1 + 2.1899996)*1000 ≈ 1810
  });

  it('берёт медиану для чётного числа значений', () => {
    // Четыре лага: 500, 1000, 1500, 2000 → медиана (1000 + 1500) / 2 = 1250
    const events = [
      ev({ isFinal: true, msFromStart: 1500, audioPosSec: 0, durationSec: 1 }), // 1500 - 1000 = 500
      ev({ isFinal: true, msFromStart: 2000, audioPosSec: 0, durationSec: 1 }), // 2000 - 1000 = 1000
      ev({ isFinal: true, msFromStart: 2500, audioPosSec: 0, durationSec: 1 }), // 2500 - 1000 = 1500
      ev({ isFinal: true, msFromStart: 3000, audioPosSec: 0, durationSec: 1 }), // 3000 - 1000 = 2000
    ];
    expect(medianFinalLagMs(events)).toBe(1250);
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
