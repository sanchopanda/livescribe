# PROGRESS — курсор состояния

Обновлять на каждой логической точке (см. [`CONVENTIONS.md`](CONVENTIONS.md)).
Истина статуса = состояние git (коммит в `main`).

## Сделано (последнее)

- **LS-06 — Хостинг бэкенда.** Beget VPS `45.147.176.79` (Ubuntu 24.04, Node 20), systemd
  `skribo-backend`, Caddy + Let's Encrypt; `wss://api.skribo.ru/ws` → `101` проверено снаружи.
  ADR-0002 + `deploy`-скилл. Продукт переименован в **Skribo** (ADR-0004).
- **LS-07 — Персистентность (Postgres).** Prisma-схема (User/Meeting/TranscriptSegment/
  Analysis/PersonalToken); WS-сессия с валидным токеном сохраняется как `Meeting` + сегменты.
- **LS-08 sub-plan 1 — Фундамент кабинета.** Email+пароль auth (JWT httpOnly cookie),
  `/api/auth/*`, персональные токены `/api/tokens`, read-API `/api/meetings` (list+detail,
  user-scoped). Диапазон `a082fab..8d18083`. Финальное ревью (opus) → merge with fixes;
  фикс `8d18083` (prod-требование секретов, verifyJwt claim, prisma generate, prod-CORS).
- Meet per-track (`ea04f9c`), STT=Deepgram (`245436c`, ADR-0001), dev-flow, ADR-0003.

## Сделано (ещё)

- **LS-08 sub-plan 2 — SPA-шелл кабинета** (`packages/admin`: React 19/Vite 6/RR7/
  `*.module.scss`, акцент `#0d9488`). Вход/регистрация (email+пароль, cookie-сессия),
  app-shell с сайдбаром (Переговоры/Настройки/профиль+выход), Настройки с управлением
  персональным токеном расширения. Финальное ревью (opus) пройдено; браузер-проверка на
  каждом шаге. Диапазон `1809e2f..5482a04`.
- **LS-08 sub-plan 3 — Список переговоров.** `packages/admin` `MeetingsPage`: `listMeetings`,
  поиск/сортировка/состояния, карточки встреч (форматтеры дата/длительность/платформа).
- **Привязка расширения ↔ кабинет.** Поле токена в content-виджете (`chrome.storage.local`),
  токен уходит в WS `start` (service-worker → offscreen). Коммит `ad7614e`.
- ✅ **Связь проверена сквозняком:** WS-`start` с токеном → `Meeting` создаётся и виден в
  списке кабинета (UI + `/api/meetings`); без токена — аноним (встречи нет).
- **LS-08 sub-plan 4 — Карточка встречи.** `MeetingDetailPage` (`/meetings/:id`): шапка +
  транскрипт по спикерам + панель-заглушка анализа («Анализ появится позже»); карточки
  списка стали ссылками (`Link` на `/meetings/:id`, hover-бордер `$accent`); 404 →
  «Встреча не найдена». Браузер-проверка сквозняком (сид Meeting+TranscriptSegment через
  `psql`, клик по карточке, переход назад, несуществующий id). **LS-08 (кабинет-MVP)
  закрыт.**

## Сделано (деплой кабинета)

- **Кабинет задеплоен и LIVE: `https://app.skribo.ru`.** PostgreSQL 16 на ВМ + миграции;
  прод-`.env` (JWT_SECRET/DATABASE_URL/WEB_ORIGIN/NODE_ENV=production); admin выложен в
  `/var/www/skribo-admin`; Caddy vhost `app.skribo.ru` (статика SPA + `/api` → :3001) с
  TLS Let's Encrypt. Регистрация/вход/список — работают в проде против Postgres.
  `wss://api.skribo.ru/ws` не задет (расширение работает). `deploy`-скилл обновлён.

## Сделано (последнее, LS-11)

- **LS-11 — нормальный логин в расширении.** Убран ручной ввод токена. Попап расширения:
  фолбэк email+пароль (`POST /api/auth/extension-login` → `{user,token}`) + авто-подхват сессии
  кабинета (`GET /api/auth/me` → `POST /api/auth/extension-token`, оба по cookie), токен
  ротируется (не копится) и кладётся в `chrome.storage.local.skriboToken`. Бэкенд-цепочка
  проверена сквозняком curl/psql/WS-скриптом: оба пути логина (200/{user,token} 64-hex, 401/400
  негативные кейсы), ровно один `label='extension'`-токен после повторных вызовов, и
  токен → WS `start` → `Meeting` → `GET /api/meetings` — тот же id встречи от записи до
  списка. Отчёт: `.superpowers/sdd/task-3-report.md`.
  - ✅ **Проверено в реальном Chrome:** вход в попапе работает (email+пароль). Фиксы по пути:
    добавлен permission `"storage"` (без него попап висел на «Проверяем аккаунт»); пересобран+
    перезапущен прод-бэкенд (эндпоинты `extension-login/token` отвечали 404 — старая сборка).
    Кросс-доменный авто-подхват cookie в Chrome не срабатывает (ожидаемо) → рабочий путь —
    форма логина. LS-11 закрыт.

## Сделано (последнее, LS-14)

- **LS-14 — триггер-слова → подсветка в расширении.** В content-виджете добавлена секция
  «Триггеры» (добавить/удалить, персист в `chrome.storage.local.skriboTriggers`, дедуп
  case-insensitive). Детект внутри `appendTranscriptReplica` (единственный путь финальных
  реплик — partial не триггерит) по границе слова, регистронезависимо, Unicode/кириллица
  (RegExp `(^|\P{L})…($|\P{L})` c fallback на `includes`). При матче: реплика подсвечивается
  инлайн-стилями (`border-left #0d9488` + лёгкий фон) и весь виджет коротко пульсирует через
  Web Animations API (без инжекта `<style>`). Клиентское, без бэкенда/LLM. Коммиты
  `3cc066f` (конфиг) + `56b0705` (детект/подсветка). Оба task-ревью чисто; финальное ревью
  (opus) → **merge**, fix-before-merge нет. Спека/план — в `docs/superpowers/`.
  - ⚠️ **Визуальная проверка за пользователем:** среда агента не грузит unpacked-расширение.
    Проверить в Chrome: добавить триггер → финальная реплика с ним → подсветка + вспышка;
    partial с триггером — не триггерит; список триггеров переживает перезагрузку.

## Сделано (последнее, LS-09A)

- **LS-09 под-проект A — анализ встречи в кабинете (LLM/OpenRouter, ADR-0006).** LLM-ядро
  `packages/backend/src/llm/` (`config`, `openrouter` `chatJson`+ретрай, `transcript`,
  `analysis`) с юнит-тестами (14 зелёных). Синхронный `POST /api/meetings/:id/analysis`
  (JWT-cookie, user-scoped): финальные сегменты → LLM (модель `LLM_MODEL_DETAILED`) → саммари +
  action items → upsert `Analysis` → DTO; коды `503 analysis_unavailable` (нет ключа) /
  `404` / `400 no_transcript` / `502 analysis_failed`, **без 500** (LLM и upsert в try/catch).
  `GET /api/meetings/:id` дополнен `analysis.createdAt`. Кабинет: панель «Анализ» с кнопкой
  «Проанализировать»/«Перегенерировать», состояния загрузки/ошибки, рендер саммари + задач.
  Диапазон `aca366d..61cd26f`. Оба task-ревью + финальное ревью (opus) → **merge**, fix-first нет.
  - ⚠️ **Живая проверка за пользователем/деплоем:** нужен `OPENROUTER_API_KEY` в прод-`.env`
    (+ рестарт). Без ключа фича мягко выключена (503). Реальный LLM-раунд-трип и браузер-рендер
    в среде агента не гонялись.

## Сделано (последнее, LS-09B)

- **LS-09 под-проект B — live-саммари в расширении.** Кнопка «Саммари встречи» в content-виджете:
  собирает текущий транскрипт (`transcriptReplicas` + partial) → сообщение в service worker →
  cross-origin `fetch(__API_URL__ + '/api/live-summary')` с Bearer `skriboToken` (SW, не content —
  из-за CORS) → рендер 3-6 тезисов (эфемерно). Бэкенд: `POST /api/live-summary` (токен-авторизация
  `resolveUserByToken`, `LLM_MODEL_LIVE`, коды 401/503/400/502, без персиста) + `LiveSummaryDTO`.
  Диапазон `858d0b8..fc27a6a` (+ docs `e8fe0c9`). Оба task-ревью + финальное (opus) → **merge**.
  - ⚠️ **Живая проверка за пользователем:** нужен `OPENROUTER_API_KEY` на сервере (иначе 503 →
    «Саммари пока не настроено»). Кнопку на реальном звонке проверить вручную (как LS-14).

## Сделано (последнее, LS-12)

- **LS-12 — восстановление пароля по email (SMTP/nodemailer, ADR-0007).** Модель
  `PasswordResetToken` (хеш токена, TTL 1ч, одноразовый — атомарно через `updateMany where usedAt:null`)
  + миграция `20260727143750`. Почтовый модуль `packages/backend/src/email/` (config + mailer,
  feature-gated: без SMTP no-op + warn). Эндпоинты `POST /api/auth/forgot` (всегда 200, без
  энумерации, письмо best-effort) + `/api/auth/reset` (токен + пароль≥8, single-use). Кабинет:
  `ForgotPasswordPage` (`/forgot`) + `ResetPasswordPage` (`/reset`) — публичные роуты, `TextField`
  с глазком, + ссылка «Забыли пароль?» на логине. Диапазон `62c3bb4..01f5577` (+docs `bff1d13`).
  Оба* task-ревью + финальное (opus) → **merge**; пост-финал фикс `01f5577` (атомарный single-use).
  - ⚠️ **Деплой:** SMTP-креды (`SMTP_*`) + `APP_URL` в prod-`.env` + `prisma migrate deploy`; без
    SMTP forgot всё равно 200 (письмо не уходит). Живой email-флоу — за пользователем/деплоем.

## Деплой (2026-07-27)

- **LS-09 (A+B) + LS-12 задеплоены на прод** (`52797bd`). rsync → сборка shared+backend
  (nodemailer установлен) → `prisma migrate deploy` (применена `20260727143750_password_reset_token`)
  → рестарт `skribo-backend` → сборка admin → `/var/www/skribo-admin`. Пост-проверки зелёные:
  `wss://api.skribo.ru/ws` 101; `app.skribo.ru/login` 200; `/reset` (SPA-fallback) 200;
  `/api/auth/me` 401; `/api/auth/forgot` 200; `/api/auth/reset` (левый токен) 400;
  `/api/live-summary` (без токена) 401.
- ⚠️ **Ключи ещё не заданы:** `OPENROUTER_API_KEY` (анализ/саммари → 503) и `SMTP_*`+`APP_URL`
  (forgot 200, но письмо не уходит) — фичи мягко выключены до добавления кредов в
  `/root/skribo/packages/backend/.env` + рестарт.

## Сделано (последнее, LS-10)

- **LS-10 — ребренд идентификаторов пакетов `@livescribe/*` → `@skribo/*`.** Атомарный проход:
  5 имён `package.json` (корень `livescribe`→`skribo` + 4 пакета), 11 импортов `@skribo/shared`,
  алиасы сборки (extension tsconfig/vite, admin vite), `package-lock.json` (перегенерён), живые
  доки (deploy-скилл, AGENTS.md, README.md, backlog). Коммит `55e3e00`. Проверка: `type-check` +
  `build` (все воркспейсы) + 20 бэк-тестов зелёные; `@livescribe` в коде/конфигах/живых доках не
  осталось. **Рантайм не тронут** (DOM-id `livescribe-*`, ключи `localStorage`, лог-префиксы
  `[LiveScribe]`, MAIN-world-маркеры — на месте, ренейм — отдельный follow-up). Ревью (spec ✅,
  Approved). Прод-поведение не меняется (идентификаторы — build-time), редеплой не обязателен.

## Сделано (последнее, LS-05 + LS-15)

- **LS-05 — упаковка расширения под Chrome Web Store.** Иконки-монограмма (PIL, 16/48/128,
  коммитятся), store-таргет в `vite.config` (`EXT_TARGET=store`: сужены
  host_permissions/matches/web_accessible_resources, срез `platform-research`+YouTube; dev-сборка
  широкая, не тронута), `scripts/pack-extension.sh` + `npm run pack:extension` → `skribo-extension-<v>.zip`,
  публичная `/privacy` в кабинете (**LIVE** `https://app.skribo.ru/privacy`), гайд
  `docs/guides/chrome-web-store.md` (обоснования прав + data-disclosures). Финальное ревью (opus) → merge.
  Диапазон `e064fc3..547c849`.
- **LS-15 (🔒 security) — прод не хранит/не отдаёт сырое аудио.** Обнаружено при ревью LS-05:
  бэкенд писал аудио звонков в `recordings/*.wav` и **публично отдавал** без авторизации
  (`GET /recordings`, `/recordings/:filename` — проверено: на проде отдавался список 54 записей).
  Фикс: `recordingsEnabled()` (`NODE_ENV!==production`, **ленивая** проверка — модульный const
  ловил `undefined`, т.к. dotenv грузит `.env` после инициализации импортов) гейтит и запись, и
  эндпоинты. **Задеплоено**, 54 старые `.wav` удалены, `/recordings` на проде → 404; health/wss ок.
  Коммиты `cee04bb`+`61dbf7c`. Ключевая грабля — см. память про dotenv-timing.

## Сделано (последнее, LS-18 + сборки)

- **LS-18 (🐞 regression) — виджет со Start снова достижим.** Виджет создавался только из
  `chrome.action.onClicked` (service-worker), но LS-11 добавил в манифест `default_popup` —
  Chrome при наличии попапа `onClicked` не вызывает, поэтому виджет (и кнопка Start) не
  показывались вообще ни на одной платформе. Фикс: тоггл вынесен в `toggleWidgetInTab()`
  (с фолбэком на инъекцию контент-скрипта), попап шлёт `TOGGLE_WIDGET_IN_ACTIVE_TAB` и
  показывает кнопку «Показать / Скрыть виджет» (лейбл — по реальному состоянию через
  `CONTENT_WIDGET_STATE`). Плюс настройка «Показывать виджет автоматически»
  (`skriboAutoShowWidget` в `chrome.storage.local`, по умолчанию **выкл**): контент-скрипт
  сам монтирует виджет на поддерживаемой платформе при загрузке и при включении тумблера.
- **Сборки расширения: флейвор ⟂ бэкенд.** К `BUILD_TARGET=dev|prod` добавлен независимый
  `BACKEND=local|prod`; новая цель `npm run build:extension:dev-prod` → `dist-dev-prod/`
  (dev-флейвор на `api.skribo.ru`), watch — `npm run dev:extension:prod`. Dev-сборки получают
  суффикс в имени («Skribo (dev)» / «Skribo (dev → prod)»), чтобы все три уживались в Chrome
  одновременно. `npm run build:extension` собирает все три.

## Сделано (последнее, зонд разведки)

- **WebRTC-зонд для разведки платформ (подготовка к LS-02 Teams / LS-01 Zoom).** MAIN-world
  скрипт `content/research/webrtc-probe-main.ts` на `document_start` во всех фреймах — только
  в dev-флейворе (в `dist/` и `dist-store/` его нет, проверено на собранных манифестах).
  Пассивно оборачивает `RTCPeerConnection`, по запросу отдаёт `getStats()`. В виджете —
  секция «🔬 Research (dev)»: снимки накапливаются, есть скачивание/копирование JSON. В снимке:
  `inbound-rtp` по каждому `ssrc` с `audioLevel`, кто говорит по DOM, плитки участников и
  **автопоиск** DOM-атрибутов, совпадающих со `ssrc`/`trackIdentifier` (аналог `data-ssrc` у Meet).
  В `packages/extension` заведён vitest (раньше тестов не было): 11 тестов на чистый
  `report-builder`. Спека — `docs/superpowers/specs/2026-07-31-webrtc-research-probe-design.md`.
- **LS-02 закрыта как «не применимо» (2026-08-03).** Зонд отработал в живом звонке на
  `teams.cloud.microsoft`: Teams сводит звук на сервере — один `inbound-rtp`
  (`mainAudio-67003`), `audioReceivers: 1`, и при смене говорящего (три снимка за 10 мин)
  дорожка та же самая, второго потока не появилось; привязки трека к плитке в DOM нет. Teams остаётся mixed + speaker-DOM, код менять
  не потребовалось (`supportsPerTrackAudioMode: false` уже стоял). Побочно из отчёта заведена
  LS-19 (две находки по speaker-DOM Teams: `data-tid` как стабильный id, риск подхватить
  плитку шаринга). Зонд переиспользуется для LS-01 (Zoom).

## Сделано (последнее, LS-19/20/21 — качество спикеров)

- **LS-20 — спикер по времени сегмента.** Главный итог разведки Teams: раз per-track там
  невозможен, качество mixed-атрибуции становится основным рычагом. `STTResult` теперь несёт
  `startSec`/`durationSec` (Deepgram `payload.start`/`duration`), сессия ведёт таймлайн смен
  спикера с серверными метками, сегмент атрибутируется по времени начала (допуск 750 мс).
  Фолбэк на прежнее поведение, если таймингов нет. Чинит Teams и Zoom разом.
- **LS-19 — speaker-DOM Teams**: `participantId` из `data-tid` (UPN), плитки `ScreenSharing`
  пропускаются, их `aria-label` разбирается отдельным паттерном.
- **LS-21 — `resolveAudioMode` по capabilities**: платформа без per-track всегда `mixed`
  (раньше дефолтом был per-track даже для Teams/Zoom/неизвестного хоста).
- Тестов в extension стало 41, в backend 37 (было 20).

## Следующее

- Добавить на сервер `OPENROUTER_API_KEY` и SMTP-креды (+`APP_URL`) → рестарт → живая проверка
  анализа/саммари/сброса пароля.
- **Подача в Chrome Web Store — трекер: [`docs/guides/chrome-web-store.md`](guides/chrome-web-store.md)**
  (статус: не подано, код готов). Блокеры: ключи на проде (OPENROUTER + SMTP, иначе видимо
  сломанные кнопки → отказ), проверка `dist-store` в живом Chrome, тестовый аккаунт +
  test instructions. Дальше — аккаунт+$5, скриншоты, описание, подача.
- Или новая фича из бэклога (LS-05 упаковка, LS-04 reconnect UX, LS-01/02 платформы, LS-13 self-host STT).
- Опц. follow-up: рантайм-ребренд `livescribe-*` (DOM/storage/логи); LS-14 desktop-нотификация;
  LS-12 верификация email + rate-limit; ренейм GitHub-репо `livescribe`→`skribo`.

## Задача в работе

- **Транскрипт доезжает до кабинета** — разбор обращения клиента `ivanovaa1992@gmail.com`
  (8 сессий, во всех `segments` пусто). Заведены LS-22…LS-26, см. `backlog.md`.
  - **LS-22, LS-23, LS-24 — сделаны и задеплоены на прод.** Тесты 109/109, `type-check`/`build`
    чистые; resume и токены проверены поведенчески на локальной БД (не моками).
  - **LS-23 требует перезагрузки расширения** у пользователя: `resumeMeetingId` отправляет клиент,
    прод-сборка — `packages/extension/dist`. Без этого склейки не будет.
  - **LS-24: на Teams-устройстве нужен перелогин.** Его токен удалён 31.07 и восстановлению не
    подлежит; новая сборка расширения выкинет мёртвый токен сама.
  - **Открыты LS-25** (свой микрофон не попадает в транскрипт) **и LS-26** (WS отваливается
    каждые ~60 с) — обе требуют прогона в реальном браузере.

## Деплой кабинета (когда дойдём)

- Раздача **single-origin** (ADR-0003): бэкенд отдаёт `admin/dist` + SPA-fallback, `/api`
  и `/ws` на том же хосте. `sameSite=lax` работает между `*.skribo.ru`. Держать `/api`-базу
  SPA согласованной с моделью раздачи. Нужны: A-запись `app.skribo.ru` + Caddy vhost +
  статик-роут в бэкенде (сейчас его нет).

## Хвосты / follow-up (hardening, вне текущего под-плана)

- Валидация тел/квери-параметров роутов (400 вместо 500) — auth/tokens/meetings.
- Тайминг-энумерация на `/api/auth/login`; DELETE токена 404-on-miss.
- Интеграционные тесты роутов бэкенда (сейчас только unit auth-логики).
- Заполнение `Meeting.title` + поиск (в LS-09).
- Почистить `localhost` из manifest host_permissions (LS-05); redundant
  `destroyParticipantProviders`; убрать `(message as any)`-касты.
- 🔒 Сервер: парольный SSH **отключён** (`PasswordAuthentication no`, root — только по ключу);
  засветившийся пароль для SSH бесполезен. Опц.: сбросить его и в панели Beget (для консоли).
  Прод-`.env` (NODE_ENV/JWT_SECRET/DATABASE_URL/WEB_ORIGIN) и Postgres+миграции — сделаны при деплое.

## Блокеры

- Нет.
