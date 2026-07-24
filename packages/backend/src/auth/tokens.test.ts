import { describe, it, expect } from 'vitest';
import { generateToken, hashToken, signJwt, verifyJwt } from './tokens.js';

describe('tokens', () => {
  it('generates a token whose hash matches hashToken(raw)', () => {
    const { raw, hash } = generateToken();
    expect(raw).toHaveLength(64);
    expect(hashToken(raw)).toBe(hash);
  });
  it('signs and verifies a JWT round-trip', () => {
    const jwt = signJwt('user_123');
    expect(verifyJwt(jwt)?.userId).toBe('user_123');
    expect(verifyJwt('garbage')).toBeNull();
  });
});
