# 0001 — STT: только Deepgram

Статус: принято (2026-07-22)

## Контекст

В проекте было три STT-провайдера: Deepgram (облако, streaming), Vosk (локальный Python
микросервис) и Whisper (через Python-сервис / Node-заглушка). На практике надёжно работал
только Deepgram: Vosk давал низкое качество и требовал скачивания моделей, Whisper —
проблемы с библиотекой и высокая задержка/нагрузка. Поддержка трёх путей усложняла backend,
конфигурацию (`STT_PROVIDER`, `STT_SERVICE_URL`) и документацию.

## Решение

Оставить **только Deepgram** как единственный STT-провайдер.

- `STTProviderType` сужен до `'deepgram'`; фабрика и `STT_PROVIDER` по умолчанию — Deepgram.
- Удалён Python-микросервис `packages/stt-service/` (Vosk/Whisper).
- Удалены backend-провайдеры `vosk.ts`, `vosk-http.ts`, `whisper-http.ts` и устаревший
  обзор `docs/STT_ALTERNATIVES.md`.

## Последствия

- Проще backend, конфиг (`DEEPGRAM_API_KEY` + `DEEPGRAM_MODEL`) и документация.
- Требуется интернет и платный аккаунт Deepgram; офлайн-STT больше не поддерживается.
- Если понадобится вернуть локальный STT — история в git (реализация была в коммитах до
  `245436c`), решение пересматривается новым ADR.

Реализация: коммит `245436c` (`refactor(stt): drop Vosk and Whisper, keep Deepgram …`).
