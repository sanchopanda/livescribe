import { describe, it, expect } from 'vitest';
import { coerceBullets, summarizeLive } from './live-summary.js';

describe('coerceBullets', () => {
  it('keeps non-empty string bullets, trims, caps at 6', () => {
    const out = coerceBullets({ bullets: ['  Раз  ', '', 'Два', 3, null, 'Три', 'Ч', 'П', 'Ш', 'С'] });
    expect(out).toEqual(['Раз', 'Два', 'Три', 'Ч', 'П', 'Ш']);
  });
  it('returns [] on garbage/missing', () => {
    expect(coerceBullets(null)).toEqual([]);
    expect(coerceBullets({ bullets: 'nope' })).toEqual([]);
  });
});

describe('summarizeLive', () => {
  it('passes transcript to chat and coerces bullets', async () => {
    let seen = '';
    const out = await summarizeLive('Аня: Привет', {
      chat: async (args) => { seen = args.user; return { bullets: ['Пункт'] }; },
    });
    expect(seen).toContain('Аня: Привет');
    expect(out).toEqual({ bullets: ['Пункт'] });
  });
});
