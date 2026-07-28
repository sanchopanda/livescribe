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
- [x] LS-08 — **Кабинет (админка).** Стек — React+Vite+RR7+Radix+`*.module.scss` (как
  expeditor, не Tailwind), см. спеку `docs/superpowers/specs/2026-07-24-admin-cabinet-design.md`.
  Кабинет-MVP закрыт (sub-plans 1–4); деплой — отдельным пунктом ниже.
  - [x] sub-plan 1: фундамент — auth (email+пароль, JWT-cookie), `/api/auth`, `/api/tokens`,
    `/api/meetings` (list+detail). Ревью пройдено, hardening-фикс применён.
  - [x] sub-plan 2: SPA-шелл `packages/admin` (React/Vite/RR7/`*.module.scss`) +
    `/login`/`/register` + app-shell + `/settings` с токеном. Ревью пройдено.
  - [x] sub-plan 3: страница списка переговоров (поиск/сортировка/карточки).
  - [x] Привязка расширения ↔ кабинет (персональный токен в WS `start`); связь проверена
    сквозняком (запись из расширения → встреча в кабинете).
  - [x] sub-plan 4: карточка встречи (`MeetingDetailPage` — транскрипт по спикерам +
    заглушка анализа; карточки списка кликабельны). Браузер-проверено сквозняком.
  - [x] Деплой кабинета на **`app.skribo.ru`** — LIVE: Postgres на ВМ + миграции, прод-`.env`
    (JWT_SECRET/DATABASE_URL/WEB_ORIGIN/NODE_ENV), admin в `/var/www/skribo-admin`, Caddy vhost
    (статика + `/api`), TLS Let's Encrypt. Регистрация/вход/список работают в проде.
  - Лендинг — отдельно, позже.
- [x] LS-11 — **Нормальный логин в расширении.** Убран ручной ввод токена: попап расширения
  делает авто-подхват сессии кабинета (`/api/auth/me` → `/api/auth/extension-token`) с
  фолбэком на вход email+пароль (`/api/auth/extension-login`). Бэкенд-флоу и цепочка
  токен → `Meeting` → `/api/meetings` проверены curl/psql/WS-скриптом
  (`.superpowers/sdd/task-3-report.md`). ⚠️ Рендер попапа в реальном Chrome и кросс-доменный
  авто-подхват cookie — **ждут ручной проверки пользователем** (среда агента не может
  загрузить unpacked-расширение); шаги проверки — в отчёте и `docs/PROGRESS.md`.
- [x] LS-12 — **Восстановление пароля по email.** SMTP (nodemailer, провайдер в env, ADR-0007):
  модель `PasswordResetToken` (хеш, 1ч, одноразовый — атомарно), `POST /api/auth/forgot`
  (всегда 200, без энумерации) + `/api/auth/reset`, страницы кабинета `/forgot`+`/reset` + ссылка
  на логине. Финальное ревью (opus) → merge. ⚠️ Деплой: SMTP-креды + `APP_URL` в prod-`.env` +
  `prisma migrate deploy`. Верификация email при регистрации + rate-limit — follow-up.
- [ ] LS-09 — **Анализ переговоров.** LLM (OpenRouter, ADR-0006) поверх транскриптов. Под-проекты:
  - [x] **A — анализ в кабинете.** LLM-ядро `packages/backend/src/llm/` (OpenRouter-клиент +
    сборка транскрипта + analysis-профиль, юнит-тесты), `POST /api/meetings/:id/analysis`
    (саммари + action items, upsert `Analysis`, коды 503/404/400/502), панель в `MeetingDetailPage`
    (кнопка «Проанализировать»/«Перегенерировать»). Финальное ревью (opus) → merge. ⚠️ **Живая
    проверка + `OPENROUTER_API_KEY` на сервере — при деплое** (без ключа фича мягко выключена, 503).
  - [x] **B — live-саммари в расширении.** Кнопка «Саммари встречи» в виджете → тезисы (3-6) по
    текущему миту; токен-авторизованный `POST /api/live-summary` (`LLM_MODEL_LIVE`, эфемерно),
    cross-origin fetch через service worker. Финальное ревью (opus) → merge. ⚠️ Живая проверка +
    `OPENROUTER_API_KEY` — при деплое (без ключа — «Саммари пока не настроено», 503).
  - Дальше: ключевые моменты/темы, поиск по анализу, авто-анализ при завершении встречи.
- [ ] LS-13 — **Self-host RU-STT (GigaAM / Parakeet)** — *плановая, gated на триггеры*
  (см. ADR-0005: качество RU / 152-ФЗ / объём / офлайн). Приоритет GigaAM-v3 (MIT, лучший
  русский), альтернатива — Parakeet Nemotron-Streaming. Добавляется провайдером к
  `STTProvider` (GPU-микросервис). Шаги: бенчмарк RU-качества + латентности стриминга на
  реальных звонках → GPU-сайзинг/цена → провайдер `gigaam` → A/B vs Deepgram. Ресёрч:
  `docs/research/2026-07-26-stt-models-parakeet-gigaam.md`.

- [x] LS-14 — **Триггер-слова → подсветка в расширении.** Секция «Триггеры» в content-виджете
  (`chrome.storage.local.skriboTriggers`); финальная реплика с триггером (по границе слова,
  регистронезависимо, кириллица) подсвечивается инлайн-стилями + виджет пульсирует (Web
  Animations API). Клиентское, без бэкенда/LLM. Коммиты `3cc066f`+`56b0705`, финальное ревью
  (opus) → merge. ⚠️ Визуальная проверка в Chrome — за пользователем.

## Фаза: кабинет UX (референс Tactiq — `docs/research/tactiq-ui/`)

- [ ] LS-17 — **Тайминги + поиск в транскрипте** (кабинет, клиентское). `mm:ss` у реплик (из
  `tsMs`) + инпут поиска по транскрипту (фильтр/подсветка, клиентски). Быстрый win, без бэкенда.
  Спека `docs/superpowers/specs/2026-07-28-cabinet-search-transcript-ux-design.md`.
- [ ] LS-16 — **Глобальный поиск по встречам** (кабинет + бэкенд). Страница `/search` + пункт
  сайдбара; поиск встреч по названию **и содержимому транскрипта** (расширить `/api/meetings` q на
  `TranscriptSegment.text`, user-scoped), карточки + сниппет. Спека — там же. (FTS/участники/лейблы —
  follow-up.)

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
- [x] LS-05 — **Упаковка расширения под Chrome Web Store.** Иконки-монограмма (16/48/128),
  store-таргет сборки (`EXT_TARGET=store`: сужены host_permissions/matches/web_accessible_resources,
  вырезаны `platform-research` и YouTube; dev-сборка не тронута), `npm run pack:extension` → zip,
  публичная страница `/privacy` в кабинете (LIVE `https://app.skribo.ru/privacy`), гайд
  `docs/guides/chrome-web-store.md`. Финальное ревью (opus) → merge. Осталось пользователю:
  аккаунт+$5, скриншоты, заполнение дашборда, подача. Реальный логотип/локализация — follow-up.
- [x] LS-15 — **🔒 Прод не пишет и не отдаёт сырое аудио.** Была утечка: бэкенд безусловно писал
  аудио звонков в `recordings/*.wav` и отдавал их публично без авторизации (`GET /recordings`,
  `/recordings/:filename`). Загейчено `recordingsEnabled()` (`NODE_ENV !== production`, ленивая
  проверка — dotenv грузит `.env` после init модуля): в проде запись и эндпоинты отключены, в
  dev/test — работают. Задеплоено, 54 старые записи удалены, `/recordings` на проде → 404.
- [x] LS-10 — **Ребрендинг livescribe → Skribo.** Механическое переименование
  идентификаторов пакетов на `@skribo/*` (были со старым префиксом), алиасы
  `vite.config`/`tsconfig`, упоминания в коде/живых доках. Имя репозитория на GitHub —
  отдельный follow-up (см. ADR-0004).
