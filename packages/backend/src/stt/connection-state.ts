// Явное состояние соединения к Deepgram вместо одного булева connectionOpen.
//
// LS-31: булев connectionOpen не различал "соединение ещё открывается" и
// "соединение оборвалось" — оба давали false, и processAudio() реагировал на
// оба одинаково: пытался переподключиться. Из-за этого сразу после
// initialize() (пока connection.on('open') ещё не сработал) первый же вызов
// processAudio() создавал ВТОРОЕ, лишнее соединение, а первое всё равно
// открывалось следом — на сессию уходило два платных стрима Deepgram.
//
// Три состояния разрешают явно отличить "подождать открытия" (аудио тем
// временем копится в audioBuffer и уходит через flushBufferedAudio() по
// 'open') от "соединение реально умерло, нужно новое".
export type ConnectionState = 'connecting' | 'open' | 'closed';

/**
 * Реконнект допустим только если провайдер инициализирован и текущее
 * соединение уже закрыто. Во время 'connecting' и 'open' — no-op.
 */
export function shouldReconnect(state: ConnectionState, initialized: boolean): boolean {
  if (!initialized) {
    return false;
  }
  return state === 'closed';
}
