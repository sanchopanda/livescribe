// Backoff для реконнекта к Deepgram (LS-04).
//
// Раньше tryReconnect() делало одну немедленную повторную попытку при каждом
// вызове, пока соединение не 'open'. При недоступном Deepgram (просроченный
// ключ, сетевой сбой) это превращалось в шторм попыток подключения — audio
// продолжает приходить каждые ~100мс, и каждый чанк порождал новую попытку.
//
// Первая версия этого модуля останавливалась совсем после MAX_ATTEMPTS
// подряд неудач — ревью справедливо указало, что это регресс по сравнению со
// старым поведением: если Deepgram отвалился на 30 секунд и вернулся, старый
// код (пусть и штормом) сам восстанавливался, а версия с "остановкой" — нет,
// сессия молчала до конца звонка. Продукту важнее самоисцеление, чем
// экономия одной лишней попытки, поэтому политика двухфазная:
//   1) растущая фаза — 500, 1000, 2000, 4000, 8000мс (по одной попытке на
//      каждую из RECONNECT_MAX_ATTEMPTS неудач подряд) — не устраивает шторм
//      на быстрых, вероятно временных, сбоях;
//   2) steady-фаза — после того как растущая фаза исчерпана, интервал
//      фиксируется на RECONNECT_STEADY_INTERVAL_MS и продолжается БЕСКОНЕЧНО,
//      пока сессия жива — не долбит Deepgram (30с — разумная цена ожидания),
//      но и не сдаётся навсегда.
//
// isDegraded() — это не "провайдер мёртв", а "растущая фаза исчерпана,
// перешли на редкие попытки"; вызывающий код транслирует это наружу как
// STTStatus 'failed', но продолжает пытаться реконнектиться.
//
// Модуль не зависит от SDK или таймерных функций транспорта — чистая логика,
// тестируемая без реального ожидания (см. reconnect-backoff.test.ts). Сам
// setTimeout — забота вызывающего кода (DeepgramSTT), этот модуль только
// считает.

export const RECONNECT_BASE_DELAY_MS = 500;
export const RECONNECT_MAX_DELAY_MS = 8000;
export const RECONNECT_MAX_ATTEMPTS = 5;
export const RECONNECT_STEADY_INTERVAL_MS = 30_000;

/**
 * Задержка перед попыткой с данным номером (1-индексация): 500, 1000, 2000,
 * 4000, 8000мс для первых `maxAttempts` попыток, дальше — постоянный
 * интервал `RECONNECT_STEADY_INTERVAL_MS` (реконнект никогда не
 * останавливается сам). Номер попытки ниже 1 трактуется как первая попытка,
 * а не как ошибка вызывающего кода.
 */
export function delayForAttempt(
  attempt: number,
  maxAttempts: number = RECONNECT_MAX_ATTEMPTS,
): number {
  const n = Math.max(1, Math.floor(attempt));
  if (n > maxAttempts) {
    return RECONNECT_STEADY_INTERVAL_MS;
  }
  return Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (n - 1), RECONNECT_MAX_DELAY_MS);
}

export interface ReconnectBackoff {
  /** Сколько попыток подряд уже было запланировано (0 — ни одной). */
  readonly attempt: number;
  /**
   * Растущая фаза исчерпана — реконнект продолжается, но с постоянным
   * (редким) интервалом. НЕ терминально: как только `reset()` вызовут по
   * `'open'`, всё начнётся заново с 500мс.
   */
  isDegraded(): boolean;
  /**
   * Отметить очередную неудачу подключения. Возвращает задержку в мс перед
   * следующей попыткой — растущую на первых `maxAttempts` неудачах, затем
   * постоянную; реконнект никогда не прекращается сам по себе.
   */
  recordFailure(): number;
  /** Сбросить счётчик — вызывается по успешному 'open'. */
  reset(): void;
}

export function createReconnectBackoff(
  maxAttempts: number = RECONNECT_MAX_ATTEMPTS,
): ReconnectBackoff {
  let attempt = 0;

  return {
    get attempt(): number {
      return attempt;
    },

    isDegraded(): boolean {
      return attempt >= maxAttempts;
    },

    recordFailure(): number {
      attempt += 1;
      return delayForAttempt(attempt, maxAttempts);
    },

    reset(): void {
      attempt = 0;
    },
  };
}
