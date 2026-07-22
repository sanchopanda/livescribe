---
name: implement-task
description: >-
  Реализовать задачу livescribe по стандартам репозитория: TDD для логики, английские
  доменные термины, монорепо npm (extension MV3 + Fastify/WS backend + shared),
  STT только Deepgram, обновление документации. Использовать на этапе кодинга.
---

# implement-task — реализация задачи

Тонкая обёртка: несёт стек-правила livescribe и делегирует общим навыкам. Не мержит и не
отмечает задачу done — это делает `proceed`.

## Перед кодом

1. Прочитать `AGENTS.md`, `docs/KNOWLEDGE.md` и спеку фичи (`docs/specs/`, если есть; для
   новой фичи — набросать краткую спеку).
2. Работать **прямо в `main`** (практика репо). Ветку `feat/<id>-<slug>` (латиница,
   kebab-case) заводить только когда нужна изоляция.

## Стандарты (обязательно)

- **Английские доменные термины** в коде (файлы/классы/типы/эндпоинты); русский — только в
  UI-тексте и документации.
- **TDD для логики** (кодеки, VAD, расчёты, парсинг): сначала падающий тест → минимальная
  реализация → зелёный. Использовать навык `superpowers:test-driven-development`.
- **Монорепо npm workspaces.** Общие типы — `packages/shared` (`websocket-protocol.ts`,
  `audio-types.ts`).
- **Extension (MV3, Vite/React).** Слои: `content` / `service-worker`(background) / `popup`.
  Per-track использует MAIN-world WebRTC-хук. При добавлении платформы — обновить
  `public/manifest.json` (matches + регистрация MAIN-world скрипта) и entry в `vite.config.ts`;
  включить флаги в `platform/audio-mode-capabilities.ts`.
- **Backend (Fastify + WebSocket).** Роутинг сообщений `start`/`audio`/`stop` в
  `websocket/handler.ts`. **STT — только Deepgram** (см. ADR-0001); не возвращать Vosk/Whisper.
- **Conventional Commits** + трейлер `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## После кода

- Обновить документацию: `docs/KNOWLEDGE.md` (новые правила/термины/грабли), спеку фичи,
  при архитектурном решении — ADR (`docs/decisions/NNNN-...`).

## Проверка себя перед выходом

- `npm run type-check` зелёный (гейт; `lint` в проекте сломан — не опираться).
- Тесты на новую логику есть и проходят.
- Нет `.env`/секретов/`dist`/`node_modules` в индексе.
