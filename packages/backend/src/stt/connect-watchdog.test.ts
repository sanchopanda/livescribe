import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnectWatchdog } from './connect-watchdog.js';

describe('createConnectWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the timeout callback once the deadline passes without open', () => {
    // LS-31 (доделка): @deepgram/sdk не даёт собственного connect-таймаута —
    // если транспорт не эмитит вообще ничего (файрвол, зависший TCP-хендшейк),
    // без сторожевого таймера состояние 'connecting' держится вечно.
    const watchdog = createConnectWatchdog({ timeoutMs: 8000 });
    const onTimeout = vi.fn();

    watchdog.start(onTimeout);
    vi.advanceTimersByTime(7999);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not fire once cancelled before the deadline (e.g. open arrived)', () => {
    const watchdog = createConnectWatchdog({ timeoutMs: 8000 });
    const onTimeout = vi.fn();

    watchdog.start(onTimeout);
    vi.advanceTimersByTime(5000);
    watchdog.cancel();
    vi.advanceTimersByTime(10000);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('restarting cancels the previous timer so it never double-fires on a fast reconnect', () => {
    const watchdog = createConnectWatchdog({ timeoutMs: 8000 });
    const first = vi.fn();
    const second = vi.fn();

    watchdog.start(first);
    vi.advanceTimersByTime(6000);
    watchdog.start(second); // новое соединение — старый таймер не должен переживать смену

    vi.advanceTimersByTime(8000);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('cancel after firing is a safe no-op', () => {
    const watchdog = createConnectWatchdog({ timeoutMs: 8000 });
    const onTimeout = vi.fn();

    watchdog.start(onTimeout);
    vi.advanceTimersByTime(8000);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    expect(() => watchdog.cancel()).not.toThrow();
    vi.advanceTimersByTime(100000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});
