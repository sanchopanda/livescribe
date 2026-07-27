import { describe, it, expect } from 'vitest';
import { coerceAnalysis, analyzeMeeting } from './analysis.js';

describe('coerceAnalysis', () => {
  it('keeps valid summary + object/string action items', () => {
    const out = coerceAnalysis({
      summary: 'Итог',
      actionItems: [{ text: 'Сделать X', owner: 'Аня' }, 'Позвонить Бобу', { text: '' }, 42],
    });
    expect(out.summary).toBe('Итог');
    expect(out.actionItems).toEqual([{ text: 'Сделать X', owner: 'Аня' }, { text: 'Позвонить Бобу' }]);
  });
  it('normalizes missing/garbage to empty', () => {
    expect(coerceAnalysis(null)).toEqual({ summary: '', actionItems: [] });
    expect(coerceAnalysis({ actionItems: 'nope' })).toEqual({ summary: '', actionItems: [] });
  });
});

describe('analyzeMeeting', () => {
  it('builds transcript and coerces injected chat result', async () => {
    let seenUser = '';
    const out = await analyzeMeeting(
      [{ speaker: 'Аня', text: 'Запустим проект' }],
      { chat: async (args) => { seenUser = args.user; return { summary: 'S', actionItems: [{ text: 'T' }] }; } }
    );
    expect(seenUser).toContain('Аня: Запустим проект');
    expect(out).toEqual({ summary: 'S', actionItems: [{ text: 'T' }] });
  });
});
