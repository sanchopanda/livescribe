import { describe, it, expect } from 'vitest';
import { buildTranscriptText } from './transcript.js';

describe('buildTranscriptText', () => {
  it('formats speaker lines in given order', () => {
    const out = buildTranscriptText([
      { speaker: 'Аня', text: 'Привет' },
      { speaker: 'Боб', text: 'Здорово' },
    ]);
    expect(out).toBe('Аня: Привет\nБоб: Здорово');
  });
  it('skips empty/whitespace segments and falls back speaker', () => {
    const out = buildTranscriptText([
      { speaker: null, text: 'Раз' },
      { speaker: 'X', text: '   ' },
    ]);
    expect(out).toBe('Спикер: Раз');
  });
  it('truncates very long transcripts with a marker', () => {
    const long = Array.from({ length: 5000 }, () => ({ speaker: 'A', text: 'слово слово слово' }));
    const out = buildTranscriptText(long);
    expect(out.endsWith('[транскрипт усечён]')).toBe(true);
    expect(out.length).toBeLessThan(24100);
  });
});
