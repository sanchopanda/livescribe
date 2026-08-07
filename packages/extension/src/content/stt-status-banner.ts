// Чистая логика баннера статуса распознавания (LS-04).
//
// Бэкенд шлёт stt_status только при смене агрегированного состояния сессии (см.
// SttStatusMessage в @skribo/shared), поэтому виджету достаточно помнить последнее
// полученное значение, чтобы решить, что показать: предупреждение при переподключении,
// ошибку при исчерпанных попытках и короткое "восстановлено" при возврате к норме —
// но только если до этого действительно была деградация, а не на каждый 'ok'.

export type SttStatusState = 'ok' | 'reconnecting' | 'failed';

export type SttBannerKind = 'hidden' | 'warning' | 'error' | 'recovered';

export interface SttBannerState {
  kind: SttBannerKind;
  text: string;
}

// Аудио пишется независимо от этого статуса — формулировка ниже обязана дать это понять,
// иначе человек решит, что встреча потеряна, и начнёт её пересоздавать.
export const STT_BANNER_TEXT = {
  reconnecting: 'Связь с распознаванием потеряна, восстанавливаем…',
  failed: 'Распознавание недоступно. Запись идёт, текст появится позже.',
  recovered: 'Распознавание восстановлено',
} as const;

/**
 * Решает следующее состояние баннера по предыдущему и текущему статусу STT.
 *
 * `prev` — последний обработанный статус (`null`, если сообщений ещё не было).
 * Идемпотентность важна: повторный одинаковый статус не должен переигрывать
 * анимацию "восстановлено" — иначе вызывающий код будет каждый раз заново
 * запускать таймер показа тоста.
 */
export function nextBannerState(prev: SttStatusState | null, incoming: SttStatusState): SttBannerState {
  if (incoming === 'reconnecting') {
    return { kind: 'warning', text: STT_BANNER_TEXT.reconnecting };
  }

  if (incoming === 'failed') {
    return { kind: 'error', text: STT_BANNER_TEXT.failed };
  }

  // incoming === 'ok'
  const wasDegraded = prev === 'reconnecting' || prev === 'failed';
  if (wasDegraded) {
    return { kind: 'recovered', text: STT_BANNER_TEXT.recovered };
  }

  return { kind: 'hidden', text: '' };
}
