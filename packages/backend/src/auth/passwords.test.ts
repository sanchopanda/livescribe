import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './passwords.js';

describe('passwords', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('s3cret!');
    expect(hash).not.toBe('s3cret!');
    expect(await verifyPassword('s3cret!', hash)).toBe(true);
    expect(await verifyPassword('nope', hash)).toBe(false);
  });
});
