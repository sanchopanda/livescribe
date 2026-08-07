import { describe, expect, it } from 'vitest';
import { isActiveConnection } from './connection-guard.js';

describe('isActiveConnection', () => {
  it('accepts a result whose connection is still the current one', () => {
    const connection = {};
    expect(isActiveConnection(connection, connection)).toBe(true);
  });

  it('rejects a result from a connection that reconnect already swapped out', () => {
    // После tryReconnect() this.connection указывает на НОВОЕ соединение,
    // а result-обработчик старого соединения ещё может сработать позже —
    // такой результат нужно отбросить, а не пропускать через offset новой сессии.
    const staleConnection = {};
    const currentConnection = {};
    expect(isActiveConnection(currentConnection, staleConnection)).toBe(false);
  });

  it('treats undefined/null connections as distinct sources', () => {
    expect(isActiveConnection(null, undefined)).toBe(false);
    expect(isActiveConnection(undefined, undefined)).toBe(true);
  });
});
