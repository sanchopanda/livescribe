# Дизайн: live-саммари в расширении (LS-09, под-проект B)

Дата: 2026-07-27
Статус: согласован

## Контекст и цель

LLM-ядро `packages/backend/src/llm/` уже построено (под-проект A). Нужна **вторая фича**:
по кнопке в виджете расширения показать быстрое саммари **текущего живого мита** — 3-6
коротких тезисов. Приоритет — скорость (быстрая модель), эфемерно (ничего не сохраняем).

Расширение получает от WS **sessionId** (id WS-сессии), а НЕ id встречи в БД, поэтому
`POST /api/meetings/:id/...` не подходит. Зато у расширения есть самый свежий транскрипт в
памяти (`transcriptReplicas`). Решение: расширение шлёт свой текущий транскрипт на
токен-авторизованный эндпоинт.

## Ключевые решения

1. **Формат вывода — тезисы** (3-6 коротких буллетов «суть/договорённости»). Не абзац, не action items.
2. **Источник данных — транскрипт из расширения** (in-memory `transcriptReplicas`), не БД: свежее
   всего, не зависит от тайминга персиста, meetingId не нужен.
3. **Авторизация — персональный токен** расширения (`skriboToken`), `Authorization: Bearer` →
   `hashToken` → `PersonalToken` → userId.
4. **Кросс-доменный fetch делает service worker** (host_permissions на `api.skribo.ru` уже есть),
   а не content-script — иначе CORS (origin страницы звонка). content.ts общается с SW сообщением.
5. **Эфемерно** — результат нигде не сохраняется. Быстрая модель `LLM_MODEL_LIVE` (дефолт Haiku 4.5).

## Архитектура

### Бэкенд

- **`packages/backend/src/llm/live-summary.ts`**:
  - `coerceBullets(raw): string[]` — из ответа берёт `bullets` (массив), тримит, дропает пустые,
    кап ~6.
  - `summarizeLive(transcript, deps?): Promise<{ bullets: string[] }>` — `chatJson` с
    `getLiveModel()`, `maxTokens ~400`, `timeoutMs ~15000`; промпт: «3-6 коротких тезисов сути и
    договорённостей встречи, на языке расшифровки, JSON `{"bullets": [строки]}`». Инъекция `chat`
    для тестов.
- **Хелпер авторизации по токену** (в `packages/backend/src/auth/`): `resolveUserByToken(rawToken):
  Promise<{ id: string } | null>` — `PersonalToken.findFirst({ where: { tokenHash: hashToken(raw) } })`
  → `{ id: userId }` или null.
- **`packages/backend/src/api/llm-routes.ts`** — `registerLlmRoutes(server)` с
  `POST /api/live-summary`:
  - Bearer-токен из заголовка → `resolveUserByToken`; нет/невалиден → `401 unauthorized`.
  - `!isLlmConfigured()` → `503 analysis_unavailable`.
  - Тело `{ transcript: string }`; пустой/пробельный → `400 no_transcript`; длину капим (последние
    ~16000 символов).
  - `summarizeLive` → `200 { bullets }`; LLM-ошибка → `502 analysis_failed`. Без персиста.
  - Зарегистрировать в `server.ts` рядом с прочими роутами.
- **Shared** `packages/shared/src/domain.ts`: `LiveSummaryDTO { bullets: string[] }`.

### Расширение

- **service worker** (`background/service-worker.ts`) — в существующем `onMessage`-листенере ветка
  `LIVE_SUMMARY`: `getSkriboToken()` (нет → `sendResponse({ error: 'not_authed' })`), затем
  `fetch(__API_URL__ + '/api/live-summary', { method:'POST', headers:{authorization:Bearer, content-type}, body: JSON.stringify({transcript}) })`;
  ответ → `sendResponse({ bullets })` или `sendResponse({ error: <code> })`. Вернуть `true`
  (async).
- **content.ts (виджет)** — кнопка «Саммари» рядом с транскриптом/триггерами. Клик: собрать
  транскрипт из `transcriptReplicas` (+ текущий `partialReplica`) как `Спикер: текст\n…`; пусто →
  инлайн-сообщение, запрос не слать. Иначе → `chrome.runtime.sendMessage({type:'LIVE_SUMMARY',
  transcript})` → рендер тезисов в эфемерной панели виджета: спиннер при загрузке, кнопка
  становится «Обновить», ошибки по коду.
- Manifest НЕ трогаем (`api.skribo.ru` в host_permissions, `storage` есть).

## Обработка ошибок (UI в виджете)

| Код | Сообщение |
|---|---|
| `not_authed` | «Войдите в расширении, чтобы получить саммари» |
| `503` / `analysis_unavailable` | «Саммари пока не настроено» |
| `400` / `no_transcript` | «Нет транскрипта для саммари» |
| иначе (`502`/сеть) | «Не удалось получить саммари. Попробуйте ещё раз» |

## Тестирование

- **Юнит (vitest):** `coerceBullets` (валидный массив, мусор → [], лишнее обрезано), `summarizeLive`
  (инъекция chat → форма ответа), `resolveUserByToken` (мок prisma: валидный/невалидный токен).
- **Расширение:** `npm run type-check` + `npm run build:extension` зелёные; живая проверка (кнопка
  на реальном звонке → тезисы) — за пользователем (среда агента не грузит расширение), как в LS-14.

## Критерии готовности

- На звонке кнопка «Саммари» в виджете → 3-6 тезисов текущего разговора; «Обновить» перезапрашивает.
- Кейсы: не залогинен / нет ключа / нет транскрипта → понятные сообщения, без падений.
- Ничего не персистится; используется `LLM_MODEL_LIVE`.
- Бэк: `type-check` + юнит-тесты зелёные; расширение: `type-check` + build зелёные.

## Вне объёма (follow-up)

- Стрим/авто-обновление саммари по ходу; действия/решения отдельным списком.
- Rate-limit/учёт стоимости live-запросов.
- Прокидывание meetingId в WS-`status` (если позже понадобится привязка live-саммари к встрече).
