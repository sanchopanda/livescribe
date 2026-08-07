import { describe, expect, it } from 'vitest';
import { shouldReconnect } from './connection-state.js';

describe('shouldReconnect', () => {
  it('forbids reconnect while the connection is still connecting', () => {
    // Именно эта ветка — причина LS-31: processAudio() дёргает tryReconnect()
    // раньше, чем сработал 'open', и раньше создавался лишний параллельный коннект.
    expect(shouldReconnect('connecting', true)).toBe(false);
  });

  it('forbids reconnect while the connection is already open', () => {
    expect(shouldReconnect('open', true)).toBe(false);
  });

  it('allows reconnect once the connection is closed', () => {
    expect(shouldReconnect('closed', true)).toBe(true);
  });

  it('forbids reconnect when not initialized, regardless of state', () => {
    expect(shouldReconnect('closed', false)).toBe(false);
    expect(shouldReconnect('connecting', false)).toBe(false);
    expect(shouldReconnect('open', false)).toBe(false);
  });
});
