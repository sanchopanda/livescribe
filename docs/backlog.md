# Backlog

Список задач livescribe. Идентификатор — `LS-NN`. Порядок внутри фазы = приоритет.
Правила — в [`CONVENTIONS.md`](CONVENTIONS.md). Курсор состояния — в [`PROGRESS.md`](PROGRESS.md).

## Сделано

- [x] LS-00 — Meet per-track WebRTC-пайплайн (коммит `ea04f9c`).
- [x] LS-00 — STT сведён к одному Deepgram (коммит `245436c`, ADR-0001).
- [x] LS-00 — dev-flow: скиллы + конвенции документации + релиз-ноуты.

## Фаза: инфраструктура и продукт (приоритет)

- [x] LS-06 — **Хостинг бэкенда.** Beget VPS (`45.147.176.79`), systemd `skribo-backend`,
  Caddy TLS, `wss://api.skribo.ru/ws` работает. ADR-0002 + `deploy`-скилл. (Хвосты: CORS,
  чистка manifest, хардненинг сервера.)
- [ ] LS-07 — **Postgres + персистентность.** Сейчас транскрипты только в WAV на диск.
  Добавить БД и хранение сессий/транскриптов; аудио — в объектное хранилище.
- [ ] LS-08 — **Лендинг + скелет админки.** Пакеты `packages/landing` и `packages/admin`
  (React+Vite+Tailwind), single-port раздача из бэкенда. Сначала ADR-0003 (раскладка
  монорепо + single-port) и краткая спека, потом код.
- [ ] LS-09 — **Анализ переговоров.** LLM-API поверх истории транскриптов в админке
  (саммари, ключевые моменты, поиск).

## Фаза: покрытие платформ

- [ ] LS-01 — **Zoom per-track.** MAIN-world WebRTC-хук, per-track transcriber и speaker-DOM
  для Zoom; включить capabilities (сейчас у zoom всё `false`, только mixed).
- [ ] LS-02 — **Teams per-track.** У Teams уже есть speaker-DOM; добавить WebRTC-хук и
  per-track пайплайн, включить `supportsPerTrackAudioMode`/`supportsMainWorldWebRTCHook`.
- [ ] LS-03 — **Хардненинг авто-детекта платформы.** Проверить надёжность `platform-detector`
  на всех поддерживаемых доменах и обновить `manifest.json` matches.

## Фаза: устойчивость и дистрибуция

- [ ] LS-04 — **Deepgram error/reconnect UX.** Явная индикация ошибок STT и восстановления
  потока в виджете; ретраи с backoff.
- [ ] LS-05 — **Упаковка расширения.** Сборка zip для Chrome Web Store, проверка manifest
  и прав; шаги в `docs/guides/`.
- [ ] LS-10 — **Ребрендинг livescribe → Skribo.** Механическое переименование
  идентификаторов пакетов (`@livescribe/*` → `@skribo/*`), имя репозитория, алиасы
  `vite.config`/`tsconfig`, оставшиеся упоминания в коде/доках. Одним отревьюенным проходом
  (см. ADR-0004).
