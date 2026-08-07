import { describe, expect, it } from 'vitest';
import { aggregateSttStatus } from './aggregate-status.js';

describe('aggregateSttStatus', () => {
  it('reports ok for an empty list (no tracks yet, nothing to worry about)', () => {
    expect(aggregateSttStatus([])).toBe('ok');
  });

  it('reports ok when every track is ok', () => {
    expect(aggregateSttStatus(['ok', 'ok', 'ok'])).toBe('ok');
  });

  it('reports reconnecting if any single track is reconnecting, even among ok ones', () => {
    // per-track: пять участников, у одного связь моргнула — это уже стоит
    // показать, а не молчать до тех пор, пока не отвалятся все.
    expect(aggregateSttStatus(['ok', 'ok', 'reconnecting'])).toBe('reconnecting');
  });

  it('reports failed only when every track has failed', () => {
    expect(aggregateSttStatus(['failed', 'failed'])).toBe('failed');
    expect(aggregateSttStatus(['failed'])).toBe('failed');
  });

  it('reports reconnecting for a mix of failed and ok — partially degraded, not fully down', () => {
    // Решение: смешанный failed+ok — это НЕ 'ok' (по упавшей дорожке текст не
    // появится) и НЕ 'failed' (что-то ещё распознаётся) — 'reconnecting' точнее
    // передаёт "распознавание частично барахлит", чем молчаливое 'ok'.
    expect(aggregateSttStatus(['failed', 'ok'])).toBe('reconnecting');
    expect(aggregateSttStatus(['ok', 'failed', 'failed'])).toBe('reconnecting');
  });

  it('reconnecting still wins when mixed with failed', () => {
    expect(aggregateSttStatus(['failed', 'reconnecting'])).toBe('reconnecting');
  });

  it('handles a single-track session (mixed mode) the same way', () => {
    expect(aggregateSttStatus(['ok'])).toBe('ok');
    expect(aggregateSttStatus(['reconnecting'])).toBe('reconnecting');
    expect(aggregateSttStatus(['failed'])).toBe('failed');
  });
});
