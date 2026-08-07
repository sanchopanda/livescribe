// Сквозная шкала времени STT-сессии.
//
// Провайдер (Deepgram) при разрыве соединения переподключается, и новая сессия
// отсчитывает `startSec` от своего собственного нуля. Чтобы шкала, которую видит
// потребитель (speaker-timeline), оставалась монотонной в пределах ВСЕЙ записи,
// нужно на каждом реконнекте фиксировать смещение — сколько аудио уже было
// реально отправлено в предыдущие соединения — и прибавлять его к позиции,
// которую сообщает новое соединение.
//
// Модуль не зависит от SDK, чтобы логику можно было протестировать без сокетов.

export interface StreamClock {
  /** Учесть байты аудио, которые были успешно отправлены в текущее соединение. */
  addSentBytes(bytes: number): void;
  /**
   * Зафиксировать смещение при переподключении: текущее накопленное число
   * отправленных секунд добавляется к смещению, счётчик отправленных байт
   * сбрасывается для нового соединения.
   */
  markReconnect(): void;
  /** Применить накопленное смещение к позиции, пришедшей от провайдера. */
  toSessionSec(startSec: number | undefined): number | undefined;
}

/**
 * Переводит количество байт PCM-аудио в секунды звучания.
 * Формат аудио фиксирован конфигурацией соединения (linear16, 16kHz, mono),
 * поэтому длительность считается прямо из размера буфера.
 */
export function bytesToSeconds(
  bytes: number,
  sampleRate = 16000,
  bytesPerSample = 2,
): number {
  return bytes / (sampleRate * bytesPerSample);
}

export function createStreamClock(): StreamClock {
  let sentBytesSinceLastReconnect = 0;
  let offsetSec = 0;

  return {
    addSentBytes(bytes: number): void {
      sentBytesSinceLastReconnect += bytes;
    },

    markReconnect(): void {
      // Смещение считается только по реально отправленным байтам —
      // всё, что осталось в audioBuffer, уйдёт в новое соединение и
      // попадёт в его собственную шкалу с нуля, поэтому в смещение
      // это не включаем (иначе получился бы двойной учёт).
      offsetSec += bytesToSeconds(sentBytesSinceLastReconnect);
      sentBytesSinceLastReconnect = 0;
    },

    toSessionSec(startSec: number | undefined): number | undefined {
      if (startSec === undefined) {
        return undefined;
      }
      return startSec + offsetSec;
    },
  };
}
