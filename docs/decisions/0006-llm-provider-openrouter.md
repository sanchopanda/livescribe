# ADR-0006: LLM-провайдер — OpenRouter (абстракция)

Дата: 2026-07-27
Статус: принято

## Контекст

Для анализа переговоров (LS-09) нужен LLM: кабинетное детальное саммари + action items
(качество важнее скорости) и live-саммари в расширении (важна скорость). Возможные пути:
прямой Anthropic Claude SDK; RU-LLM (YandexGPT/GigaChat) ради 152-ФЗ; или шлюз-абстракция.

## Решение

Используем **OpenRouter** (OpenAI-совместимый `/chat/completions`) как единый шлюз. Модель —
строка на вызов через env: `LLM_MODEL_DETAILED` (дефолт `anthropic/claude-sonnet-4.5`) для
кабинета, `LLM_MODEL_LIVE` (дефолт `anthropic/claude-haiku-4.5`) для расширения. Одна
интеграция (`packages/backend/src/llm/openrouter.ts`), ключ `OPENROUTER_API_KEY`.

## Обоснование

- Одна интеграция для любых моделей (Claude/GPT/Gemini/…); смена модели/провайдера — через env,
  без нового SDK.
- Быстрый старт при высоком качестве (Claude по умолчанию), при этом дверь для RU-провайдера
  или прямого вендора остаётся открытой.
- Фича gated ключом: без `OPENROUTER_API_KEY` бэкенд стартует, эндпоинт отвечает `503`.

## Последствия

- **Приватность:** транскрипты уходят в облако OpenRouter (не RU-резидентно) — как аудио уже
  уходит в Deepgram. Если приватность/152-ФЗ станут жёстким требованием — сменить модель/маршрут
  (OpenRouter поддерживает разные провайдеры) или добавить прямого RU-провайдера за тем же
  интерфейсом. Ср. ADR-0005 (self-host STT ради RU-приватности).
- Стоимость — поминутная/потокенная у OpenRouter; лимиты/учёт — follow-up.
- Единая точка отказа (шлюз) — приемлемо для MVP.

## Ссылки

- Спека/план: `docs/superpowers/specs/2026-07-27-cabinet-meeting-analysis-design.md`,
  `docs/superpowers/plans/2026-07-27-cabinet-meeting-analysis.md`.
- Ядро: `packages/backend/src/llm/` (`config.ts`, `openrouter.ts`, `transcript.ts`, `analysis.ts`).
