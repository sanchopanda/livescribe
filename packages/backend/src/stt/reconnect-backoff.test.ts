import { describe, expect, it } from 'vitest';
import { createReconnectBackoff, delayForAttempt } from './reconnect-backoff.js';

describe('delayForAttempt', () => {
  it('doubles the delay for each of the first five attempts', () => {
    // LS-04: 500, 1000, 2000, 4000, 8000 — как в задаче.
    expect([1, 2, 3, 4, 5].map((n) => delayForAttempt(n))).toEqual([500, 1000, 2000, 4000, 8000]);
  });

  it('switches to the steady 30s interval past the fifth attempt, instead of stopping', () => {
    // LS-04 (ревью): растущая фаза не заканчивается остановкой — после неё
    // повторы продолжаются бесконечно, просто реже, чтобы длинный обрыв
    // Deepgram (например 30с) не убивал сессию навсегда, как это случилось бы
    // с прежним "стоп после 5 неудач".
    expect(delayForAttempt(6)).toBe(30_000);
    expect(delayForAttempt(20)).toBe(30_000);
    expect(delayForAttempt(1000)).toBe(30_000);
  });

  it('treats a non-positive attempt number as the first attempt', () => {
    expect(delayForAttempt(0)).toBe(500);
    expect(delayForAttempt(-3)).toBe(500);
  });

  it('honours a custom maxAttempts when deciding where the steady phase starts', () => {
    expect(delayForAttempt(1, 1)).toBe(500);
    expect(delayForAttempt(2, 1)).toBe(30_000);
  });
});

describe('createReconnectBackoff', () => {
  it('returns the growing delay sequence for five consecutive failures, then a steady 30s interval forever', () => {
    const backoff = createReconnectBackoff();

    expect(backoff.recordFailure()).toBe(500);
    expect(backoff.recordFailure()).toBe(1000);
    expect(backoff.recordFailure()).toBe(2000);
    expect(backoff.recordFailure()).toBe(4000);
    expect(backoff.recordFailure()).toBe(8000);
    // Растущая фаза исчерпана — но реконнект НЕ прекращается, просто реже.
    expect(backoff.recordFailure()).toBe(30_000);
    expect(backoff.recordFailure()).toBe(30_000);
    expect(backoff.recordFailure()).toBe(30_000);
  });

  it('exposes isDegraded() once the growing phase is exhausted, and keeps it true afterwards', () => {
    const backoff = createReconnectBackoff();
    expect(backoff.isDegraded()).toBe(false);

    for (let i = 0; i < 4; i++) backoff.recordFailure();
    expect(backoff.isDegraded()).toBe(false); // ещё 4 — растущая фаза не закончилась

    backoff.recordFailure(); // 5-я
    expect(backoff.isDegraded()).toBe(true);

    backoff.recordFailure(); // 6-я, уже в steady-фазе
    expect(backoff.isDegraded()).toBe(true);
  });

  it('reset() clears the counter so the delay sequence restarts from 500ms', () => {
    // Вызывается по событию 'open' — успешный реконнект должен забыть
    // предыдущую серию неудач (в том числе долгую steady-фазу), а не
    // продолжать с постоянного интервала после восстановления связи.
    const backoff = createReconnectBackoff();
    for (let i = 0; i < 7; i++) backoff.recordFailure();
    expect(backoff.isDegraded()).toBe(true);

    backoff.reset();

    expect(backoff.attempt).toBe(0);
    expect(backoff.isDegraded()).toBe(false);
    expect(backoff.recordFailure()).toBe(500);
  });

  it('honours a custom maxAttempts (e.g. a single fast attempt before going steady)', () => {
    const backoff = createReconnectBackoff(1);
    expect(backoff.recordFailure()).toBe(500);
    expect(backoff.isDegraded()).toBe(true);
    expect(backoff.recordFailure()).toBe(30_000);
    expect(backoff.recordFailure()).toBe(30_000);
  });
});
