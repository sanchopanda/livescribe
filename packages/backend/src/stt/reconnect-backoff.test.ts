import { describe, expect, it } from 'vitest';
import { createReconnectBackoff, delayForAttempt } from './reconnect-backoff.js';

describe('delayForAttempt', () => {
  it('doubles the delay for each of the first five attempts', () => {
    // LS-04: 500, 1000, 2000, 4000, 8000 — как в задаче.
    expect([1, 2, 3, 4, 5].map(delayForAttempt)).toEqual([500, 1000, 2000, 4000, 8000]);
  });

  it('caps the delay at 8000ms beyond the fifth attempt', () => {
    expect(delayForAttempt(6)).toBe(8000);
    expect(delayForAttempt(20)).toBe(8000);
  });

  it('treats a non-positive attempt number as the first attempt', () => {
    expect(delayForAttempt(0)).toBe(500);
    expect(delayForAttempt(-3)).toBe(500);
  });
});

describe('createReconnectBackoff', () => {
  it('returns the growing delay sequence for five consecutive failures, then null', () => {
    const backoff = createReconnectBackoff();

    expect(backoff.recordFailure()).toBe(500);
    expect(backoff.recordFailure()).toBe(1000);
    expect(backoff.recordFailure()).toBe(2000);
    expect(backoff.recordFailure()).toBe(4000);
    expect(backoff.recordFailure()).toBe(8000);
    // Лимит подряд неудач (5) исчерпан — провайдер считается упавшим.
    expect(backoff.recordFailure()).toBeNull();
  });

  it('exposes isExhausted() once the limit is reached, and stops counting past it', () => {
    const backoff = createReconnectBackoff();
    expect(backoff.isExhausted()).toBe(false);

    for (let i = 0; i < 5; i++) backoff.recordFailure();

    expect(backoff.isExhausted()).toBe(true);
    expect(backoff.recordFailure()).toBeNull();
    expect(backoff.attempt).toBe(5);
  });

  it('reset() clears the counter so the delay sequence restarts from 500ms', () => {
    // Вызывается по событию 'open' — успешный реконнект должен забыть
    // предыдущую серию неудач, а не продолжать шкалу задержек с того места.
    const backoff = createReconnectBackoff();
    backoff.recordFailure();
    backoff.recordFailure();
    expect(backoff.attempt).toBe(2);

    backoff.reset();

    expect(backoff.attempt).toBe(0);
    expect(backoff.isExhausted()).toBe(false);
    expect(backoff.recordFailure()).toBe(500);
  });

  it('honours a custom maxAttempts (e.g. a single retry)', () => {
    const backoff = createReconnectBackoff(1);
    expect(backoff.recordFailure()).toBe(500);
    expect(backoff.isExhausted()).toBe(true);
    expect(backoff.recordFailure()).toBeNull();
  });
});
