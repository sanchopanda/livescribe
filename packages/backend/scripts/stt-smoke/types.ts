// Общий контракт смок-прогона: одинаковый формат событий у всех провайдеров —
// только это и делает транскрипты сравнимыми построчно.

/** Одна реплика от провайдера, привязанная ко времени прогона. */
export interface SmokeEvent {
  /** Миллисекунды от начала подачи аудио — момент, когда событие пришло к нам. */
  msFromStart: number;
  isFinal: boolean;
  text: string;
  /** Позиция сегмента в аудио, если провайдер её сообщает (секунды от начала). */
  audioPosSec?: number;
  /** Длительность сегмента в секундах, если провайдер её сообщает. */
  durationSec?: number;
}

export type ProviderName = 'deepgram' | 'nemotron' | 'salute';

/** Адаптер одного провайдера. Не путать с прод-интерфейсом STTProvider — здесь свой, узкий. */
export interface SmokeRunner {
  /** Открыть соединение и подписаться на результаты. */
  start(onEvent: (event: Omit<SmokeEvent, 'msFromStart'>) => void): Promise<void>;
  /** Отправить один чанк PCM. */
  send(chunk: Buffer): void | Promise<void>;
  /** Сообщить о конце аудио и подождать хвостовые финалы не дольше trailingMs. */
  finish(trailingMs: number): Promise<void>;
}
