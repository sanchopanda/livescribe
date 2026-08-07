// Сторожевой таймер на попытку подключения к Deepgram.
//
// LS-31 (доделка): @deepgram/sdk не даёт собственного connect-таймаута —
// весь жизненный цикл соединения держится на событиях open/close/error от
// транспорта. Если конкретная попытка не эмитит вообще ничего (файрвол молча
// роняет пакеты, зависший TCP-хендшейк), состояние 'connecting' навсегда
// остаётся висеть: shouldReconnect() при 'connecting' всегда false, и
// processAudio() тихо копит аудио в audioBuffer, пока старое не вытеснится
// лимитом MAX_BUFFERED_CHUNKS — сессия молча ничего не распознаёт.
//
// Таймер инъецирует свои таймерные функции, чтобы модуль можно было
// протестировать через vi.useFakeTimers() без реального ожидания секунд.
export interface ConnectWatchdog {
  /** Запустить отсчёт заново; предыдущий незавершённый таймер отменяется. */
  start(onTimeout: () => void): void;
  /** Снять таймер (получено open/close/error, либо соединение уничтожено). */
  cancel(): void;
}

export interface ConnectWatchdogOptions {
  timeoutMs: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export function createConnectWatchdog(options: ConnectWatchdogOptions): ConnectWatchdog {
  const {
    timeoutMs,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = options;

  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    start(onTimeout: () => void): void {
      // Повторный старт (новая попытка подключения) отменяет предыдущий
      // таймер — иначе он мог бы дожить до уже живого соединения и сбить
      // ему состояние (см. общий комментарий модуля).
      if (timer !== null) {
        clearTimeoutFn(timer);
      }
      timer = setTimeoutFn(() => {
        timer = null;
        onTimeout();
      }, timeoutMs);
    },

    cancel(): void {
      if (timer !== null) {
        clearTimeoutFn(timer);
        timer = null;
      }
    },
  };
}
