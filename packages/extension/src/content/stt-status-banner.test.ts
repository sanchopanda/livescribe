import { describe, expect, it } from 'vitest';
import { nextBannerState } from './stt-status-banner';

describe('nextBannerState (LS-04)', () => {
  it('draws nothing for the very first ok (no prior degradation)', () => {
    expect(nextBannerState(null, 'ok')).toEqual({ kind: 'hidden', text: '' });
  });

  it('shows a warning while the STT link is reconnecting', () => {
    const banner = nextBannerState(null, 'reconnecting');
    expect(banner.kind).toBe('warning');
    expect(banner.text).toMatch(/восстанавлива/i);
  });

  it('shows an error once reconnection attempts are exhausted', () => {
    const banner = nextBannerState('reconnecting', 'failed');
    expect(banner.kind).toBe('error');
    // Формулировка не должна пугать пользователя потерей встречи — запись идёт.
    expect(banner.text).toMatch(/запись/i);
  });

  it('announces recovery when ok arrives after reconnecting', () => {
    const banner = nextBannerState('reconnecting', 'ok');
    expect(banner.kind).toBe('recovered');
    expect(banner.text).toMatch(/восстановлен/i);
  });

  it('announces recovery when ok arrives after failed', () => {
    const banner = nextBannerState('failed', 'ok');
    expect(banner.kind).toBe('recovered');
  });

  it('does not re-trigger "recovered" for a repeated identical ok status', () => {
    // Сервер шлёт stt_status только при смене состояния, но защищаемся и от дублей:
    // once the state has already settled on 'ok', a second identical 'ok' must not
    // produce another 'recovered' banner — иначе вызывающий код будет каждый раз
    // заново запускать таймер показа тоста.
    const first = nextBannerState('reconnecting', 'ok');
    expect(first.kind).toBe('recovered');

    const second = nextBannerState('ok', 'ok');
    expect(second.kind).toBe('hidden');
  });

  it('keeps showing the warning for repeated reconnecting statuses', () => {
    expect(nextBannerState('reconnecting', 'reconnecting')).toEqual({
      kind: 'warning',
      text: nextBannerState(null, 'reconnecting').text,
    });
  });

  it('keeps showing the error for repeated failed statuses', () => {
    expect(nextBannerState('failed', 'failed').kind).toBe('error');
  });
});
