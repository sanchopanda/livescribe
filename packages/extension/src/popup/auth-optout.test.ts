import { describe, expect, it } from 'vitest';
import {
  AUTH_OPT_OUT_KEY,
  clearSignedOut,
  hasSignedOut,
  markSignedOut,
  type OptOutStorage,
} from './auth-optout';

function fakeStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  const storage: OptOutStorage = {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
    },
    async set(items) {
      Object.assign(data, items);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      list.forEach((k) => delete data[k]);
    },
  };
  return { storage, data };
}

describe('signed-out state', () => {
  it('starts out not signed out', async () => {
    const { storage } = fakeStorage();

    expect(await hasSignedOut(storage)).toBe(false);
  });

  it('remembers a deliberate sign-out', async () => {
    const { storage, data } = fakeStorage();

    await markSignedOut(storage);

    expect(data[AUTH_OPT_OUT_KEY]).toBe(true);
    expect(await hasSignedOut(storage)).toBe(true);
  });

  it('forgets it when the user signs back in', async () => {
    const { storage } = fakeStorage({ [AUTH_OPT_OUT_KEY]: true });

    await clearSignedOut(storage);

    expect(await hasSignedOut(storage)).toBe(false);
  });

  it('treats a storage failure as not signed out rather than getting stuck', async () => {
    const storage: OptOutStorage = {
      get: () => Promise.reject(new Error('storage unavailable')),
      set: async () => {},
      remove: async () => {},
    };

    expect(await hasSignedOut(storage)).toBe(false);
  });

  it('ignores a stale non-boolean value', async () => {
    const { storage } = fakeStorage({ [AUTH_OPT_OUT_KEY]: 'yes' });

    expect(await hasSignedOut(storage)).toBe(false);
  });
});
