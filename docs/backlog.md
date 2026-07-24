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
- [x] LS-07 — **Postgres + персистентность.** Prisma-схема + сохранение сессий/транскриптов
  (WS-сессия с токеном → `Meeting` + сегменты). Сделано в фундаменте кабинета. (Аудио в
  объектное хранилище — отдельный follow-up.)
- [~] LS-08 — **Кабинет (админка).** Стек — React+Vite+RR7+Radix+`*.module.scss` (как
  expeditor, не Tailwind), см. спеку `docs/superpowers/specs/2026-07-24-admin-cabinet-design.md`.
  - [x] sub-plan 1: фундамент — auth (email+пароль, JWT-cookie), `/api/auth`, `/api/tokens`,
    `/api/meetings` (list+detail). Ревью пройдено, hardening-фикс применён.
  - [ ] sub-plan 2: SPA-шелл `packages/admin` + `/login`/`/register` + `/settings` (токен);
    деплой на `app.skribo.ru`.
  - [ ] sub-plan 3: страница списка переговоров.
  - [ ] sub-plan 4: карточка встречи (транскрипт; заглушка анализа).
  - Лендинг — отдельно, позже.
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
