// Экспоненциальный backoff для реконнекта к Deepgram (LS-04).
//
// Раньше tryReconnect() делал одну немедленную повторную попытку при каждом
// вызове, пока соединение не 'open'. При недоступном Deepgram (просроченный
// ключ, сетевой сбой) это превращалось в шторм попыток подключения — audio
// продолжает приходить каждые ~100мс, и каждый чанк порождал новую попытку.
// Экспоненциальный backoff разносит попытки по времени (500, 1000, 2000,
// 4000, 8000мс, дальше потолок) и явно останавливается после MAX_ATTEMPTS
// подряд неудач — тогда провайдер считается упавшим (см. STTStatus в
// types.ts), и вызывающий код перестаёт долбить внешний сервис.
//
// Модуль не зависит от SDK или таймерных функций транспорта — чистая логика,
// тестируемая без реального ожидания (см. reconnect-backoff.test.ts). Сам
// setTimeout — забота вызывающего кода (DeepgramSTT), этот модуль только
// считает.

export const RECONNECT_BASE_DELAY_MS = 500;
export const RECONNECT_MAX_DELAY_MS = 8000;
export const RECONNECT_MAX_ATTEMPTS = 5;

/**
 * Задержка перед попыткой с данным номером (1-индексация): 500, 1000, 2000,
 * 4000, 8000мс, дальше — потолок 8000мс. Номер попытки ниже 1 трактуется как
 * первая попытка, а не как ошибка вызывающего кода.
 */
export function delayForAttempt(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (n - 1), RECONNECT_MAX_DELAY_MS);
}

export interface ReconnectBackoff {
  /** Сколько попыток подряд уже было запланировано (0 — ни одной). */
  readonly attempt: number;
  /** Лимит последовательных неудач достигнут — реконнект больше не планируется. */
  isExhausted(): boolean;
  /**
   * Отметить очередную неудачу подключения. Возвращает задержку в мс перед
   * следующей попыткой, либо null — если лимит подряд неудач (maxAttempts)
   * уже исчерпан и провайдер нужно считать упавшим.
   */
  recordFailure(): number | null;
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

    isExhausted(): boolean {
      return attempt >= maxAttempts;
    },

    recordFailure(): number | null {
      if (attempt >= maxAttempts) {
        return null;
      }
      attempt += 1;
      return delayForAttempt(attempt);
    },

    reset(): void {
      attempt = 0;
    },
  };
}
