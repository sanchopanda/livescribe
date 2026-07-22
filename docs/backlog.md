# Backlog

Список задач livescribe. Идентификатор — `LS-NN`. Порядок внутри фазы = приоритет.
Правила — в [`CONVENTIONS.md`](CONVENTIONS.md). Курсор состояния — в [`PROGRESS.md`](PROGRESS.md).

## Сделано

- [x] LS-00 — Meet per-track WebRTC-пайплайн (коммит `ea04f9c`).
- [x] LS-00 — STT сведён к одному Deepgram (коммит `245436c`, ADR-0001).
- [x] LS-00 — dev-flow: скиллы + конвенции документации + релиз-ноуты.

## Фаза: покрытие платформ

- [ ] LS-01 — **Zoom per-track.** Добавить MAIN-world WebRTC-хук, per-track transcriber и
  speaker-DOM для Zoom; включить capabilities (сейчас у zoom всё `false`, только mixed).
- [ ] LS-02 — **Teams per-track.** У Teams уже есть speaker-DOM; добавить WebRTC-хук и
  per-track пайплайн, включить `supportsPerTrackAudioMode`/`supportsMainWorldWebRTCHook`.
- [ ] LS-03 — **Хардненинг авто-детекта платформы.** Проверить надёжность
  `platform-detector` на всех поддерживаемых доменах и обновить `manifest.json` matches.

## Фаза: устойчивость и UX

- [ ] LS-04 — **Deepgram error/reconnect UX.** Явная индикация ошибок STT и восстановления
  потока в виджете; ретраи с backoff.

## Фаза: дистрибуция

- [ ] LS-05 — **Упаковка расширения.** Сборка zip для Chrome Web Store, проверка manifest
  и прав; шаги в `docs/guides/`.
