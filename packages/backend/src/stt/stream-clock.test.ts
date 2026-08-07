import { describe, expect, it } from 'vitest';
import { bytesToSeconds, createStreamClock } from './stream-clock.js';

describe('bytesToSeconds', () => {
  it('converts bytes to seconds for 16kHz mono 16-bit PCM', () => {
    // 16000 samples/sec * 2 bytes/sample = 32000 bytes/sec
    expect(bytesToSeconds(32000)).toBe(1);
    expect(bytesToSeconds(16000)).toBe(0.5);
  });

  it('supports custom sample rate and bytes per sample', () => {
    expect(bytesToSeconds(8000, 8000, 1)).toBe(1);
  });
});

describe('createStreamClock', () => {
  it('does not change position without reconnects', () => {
    const clock = createStreamClock();
    clock.addSentBytes(32000);

    expect(clock.toSessionSec(4.97)).toBe(4.97);
  });

  it('adds the duration of previously sent audio after one reconnect', () => {
    const clock = createStreamClock();
    // Первое соединение: отправили 5 секунд аудио, затем разрыв.
    clock.addSentBytes(32000 * 5);
    clock.markReconnect();

    // Новое соединение отсчитывает свою собственную позицию от нуля.
    expect(clock.toSessionSec(0)).toBe(5);
    expect(clock.toSessionSec(2)).toBe(7);
  });

  it('accumulates offsets across two reconnects instead of overwriting', () => {
    const clock = createStreamClock();

    clock.addSentBytes(32000 * 5); // первое соединение: 5 сек отправлено
    clock.markReconnect(); // смещение = 5

    clock.addSentBytes(32000 * 3); // второе соединение: ещё 3 сек отправлено
    clock.markReconnect(); // смещение = 5 + 3 = 8

    expect(clock.toSessionSec(0)).toBe(8);
    expect(clock.toSessionSec(1.5)).toBe(9.5);
  });

  it('does not double-count bytes that were buffered but never sent', () => {
    const clock = createStreamClock();

    clock.addSentBytes(32000 * 5); // отправлено 5 сек
    // Ещё 2 секунды аудио лежат в audioBuffer, но НЕ были отправлены —
    // они не должны попасть в смещение.
    clock.markReconnect();

    // Смещение должно быть ровно 5, а не 7.
    expect(clock.toSessionSec(0)).toBe(5);
  });

  it('passes undefined through unchanged', () => {
    const clock = createStreamClock();
    clock.addSentBytes(32000 * 5);
    clock.markReconnect();

    expect(clock.toSessionSec(undefined)).toBeUndefined();
  });
});
