# Дизайн: анализ встречи в кабинете + общее LLM-ядро (LS-09, под-проект A)

Дата: 2026-07-27
Статус: согласован

## Контекст и цель

В кабинете (`MeetingDetailPage`) панель «Анализ» — заглушка «Анализ появится позже». Модель
`Analysis` (summary + actionItems Json) уже в схеме и привязана к `Meeting`; `GET
/api/meetings/:id` уже отдаёт `analysis`. LLM нигде не подключён.

Цель под-проекта A: по кнопке в карточке встречи генерировать **детальный анализ** завершённой
встречи (саммари + action items) через LLM, сохранять в `Analysis`, показывать в кабинете.
Заодно построить **общее LLM-ядро** (OpenRouter), которое переиспользует под-проект B
(live-саммари в расширении).

## Ключевые решения

1. **Провайдер — OpenRouter** (OpenAI-совместимый API). Модель — строка на вызов: детальный
   профиль = `LLM_MODEL_DETAILED` (дефолт Sonnet), live = `LLM_MODEL_LIVE` (дефолт Haiku 4.5,
   для под-проекта B). Смена модели/провайдера — через env, без нового SDK.
2. **Триггер кабинетного анализа — по кнопке** в карточке. Синхронный запрос (несколько секунд,
   фронт показывает загрузку). Повторный клик = перегенерация (upsert).
3. **Выводы MVP = саммари + action items** — ровно под существующую схему `Analysis`
   (`summary String?`, `actionItems Json?`). Схему не меняем.
4. **Приватность:** транскрипты уходят в OpenRouter (облако, не RU-резидентно) — как аудио уже
   уходит в Deepgram. Абстракция оставляет дверь для RU-провайдера позже (ADR-0005).
5. **Live-саммари в расширении — отдельный под-проект B** (свой эндпоинт, быстрая модель,
   эфемерно). Здесь НЕ реализуется; ядро строится так, чтобы B его переиспользовал.

## Архитектура

### Общее LLM-ядро — `packages/backend/src/llm/`

- **`config.ts`** — чтение env: `OPENROUTER_API_KEY` (без него анализ выключен), `LLM_MODEL_DETAILED`
  (дефолт `anthropic/claude-sonnet-4.5`), `LLM_MODEL_LIVE` (дефолт `anthropic/claude-haiku-4.5`),
  опц. `OPENROUTER_BASE_URL` (дефолт `https://openrouter.ai/api/v1`). Дефолты — просто фолбэк,
  реальные слаги задаются в env при деплое. Экспорт `isLlmConfigured(): boolean`.
- **`openrouter.ts`** — клиент `chatJson({ model, system, user, maxTokens, signal? }): Promise<unknown>`:
  `POST {base}/chat/completions` с `Authorization: Bearer <key>`, тело OpenAI-совместимое
  (`messages`, `response_format: { type: 'json_object' }`, `temperature`). Таймаут (AbortController,
  дефолт ~30с для detailed). Возвращает распарсенный JSON из `choices[0].message.content`; при
  сбое парса — **один ретрай** с более жёсткой инструкцией, иначе throw `LlmError`.
- **`transcript.ts`** — `buildTranscriptText(segments: {speaker: string|null; text: string}[]): string`:
  строки `Спикер: текст` в порядке `tsMs`; ограничение по длине (напр. ~24000 символов) — при
  превышении усечь и добавить пометку «[транскрипт усечён]».
- **`analysis.ts`** — `analyzeMeeting(segments): Promise<{ summary: string; actionItems: {text: string; owner?: string}[] }>`:
  строит system/user промпт (профиль detailed, модель `LLM_MODEL_DETAILED`), вызывает `chatJson`,
  валидирует форму ответа (summary — строка; actionItems — массив объектов с `text`). Промпт:
  язык вывода = язык транскрипта; кратко саммари (1 абзац) + явные action items с владельцем, если
  назван. Пустой/битый ответ → нормализовать (`summary: ''`/`actionItems: []`) либо throw — см. ошибки.

### Бэкенд-эндпоинт (кабинет)

- **`POST /api/meetings/:id/analysis`** в `packages/backend/src/api/meetings-routes.ts`
  (JWT-cookie guard, user-scoped):
  - `isLlmConfigured()` false → `503 { error: 'analysis_unavailable' }`.
  - Встреча не найдена / чужая → `404`.
  - Нет финальных сегментов → `400 { error: 'no_transcript' }`.
  - Иначе: `analyzeMeeting(segments)` → **upsert** `Analysis` по `meetingId` (summary + actionItems)
    → `200 { summary, actionItems, createdAt }`.
  - Ошибка LLM/таймаут → `502 { error: 'analysis_failed' }`.
- **`GET /api/meetings/:id`** — расширить сериализацию `analysis`: добавить `createdAt`
  (сейчас отдаёт `summary`, `actionItems`).

### Admin UI (`packages/admin`)

- **`api.ts`** — `analyzeMeeting(id: string): Promise<AnalysisDto>` (POST). Тип `AnalysisDto =
  { summary: string; actionItems: {text: string; owner?: string}[]; createdAt: string }`.
  Тип `Meeting.analysis` расширить до `AnalysisDto | null`.
- **`MeetingDetailPage.tsx`** — панель «Анализ»:
  - Есть `analysis` → саммари (абзац) + список action items (владелец, если есть) + кнопка
    «Перегенерировать».
  - Нет → кнопка «Проанализировать».
  - Состояния: загрузка (кнопка дизейбл + «Анализируем…»), ошибка (текст по коду: недоступно /
    нет транскрипта / ошибка) + «Повторить». После успеха — обновить локальное состояние
    встречи из ответа.
  - Стили — `*.module.scss`, акцент `#0d9488`, в духе существующей панели.

## Обработка ошибок (сводно)

| Ситуация | Бэкенд | UI |
|---|---|---|
| Нет `OPENROUTER_API_KEY` | 503 `analysis_unavailable` | «Анализ недоступен (не настроен ключ)» |
| Встреча чужая/нет | 404 | «Встреча не найдена» |
| Нет транскрипта | 400 `no_transcript` | «Нет транскрипта для анализа» |
| Ошибка/таймаут LLM | 502 `analysis_failed` | «Не удалось проанализировать» + «Повторить» |
| Сбой парса JSON | ретрай 1× в клиенте, иначе 502 | как выше |

## Тестирование

- **Юнит (vitest, уже настроен в бэке):** `buildTranscriptText` (порядок, усечение, пустой),
  парс/валидация ответа `analysis` (валидный JSON, битый JSON → ретрай-путь через мок, лишние поля),
  `isLlmConfigured`.
- **Мок OpenRouter:** юнит-тесты `analysis`/эндпоинта мокают `chatJson`/`fetch` (без реальной сети).
- **Ручная проверка:** сид-встреча с сегментами (`psql`) + реальный `OPENROUTER_API_KEY` → curl
  `POST /api/meetings/:id/analysis` → 200 с саммари; браузер-проверка в кабинете (кнопка →
  загрузка → саммари + action items; перегенерация; кейсы 400/502/503).

## Критерии готовности

- В кабинете кнопка «Проанализировать» → саммари + action items появляются и сохраняются
  (переживают перезагрузку страницы); «Перегенерировать» пере-создаёт.
- Кейсы ошибок (нет ключа / нет транскрипта / сбой LLM) дают понятный UI, не 500.
- Ключ и модели конфигурируются через env; без ключа фича мягко выключена (503, не падение).
- `npm run type-check` + сборка бэка и админки зелёные; юнит-тесты ядра зелёные.

## Вне объёма (follow-up)

- Под-проект B: live-саммари в расширении (`POST /api/meetings/:id/live-summary`, `LLM_MODEL_LIVE`,
  эфемерно, кнопка в виджете) — отдельная спека/план.
- «Ключевые моменты/темы», поиск по анализу, авто-генерация при завершении встречи, стоимость/лимиты.
- ADR о выборе OpenRouter (зафиксировать отдельно).
