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
  - ⚠️ **Не проверено (нужен человек):** рендер попапа внутри реального Chrome и
    кросс-доменный авто-подхват cookie (`fetch(credentials:'include')` из
    `chrome-extension://` на `app.skribo.ru`) — среда агента не может загрузить unpacked
    расширение. Ручная проверка: собрать
    `API_URL=https://api.skribo.ru CABINET_URL=https://app.skribo.ru WS_URL=wss://api.skribo.ru/ws npm run build:extension`,
    загрузить `packages/extension/dist` в `chrome://extensions`, открыть попап (без сессии
    кабинета → форма логина; с сессией кабинета в другой вкладке → авто-вход).

## Следующее

- Затем LS-09 (анализ переговоров).

## Задача в работе

- Нет (между под-планами). Локальные коммиты не запушены в `origin`.

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
- 🔒 Сервер: сменить засветившийся root-пароль (панель Beget), отключить парольный SSH;
  задать `NODE_ENV=production`/`JWT_SECRET`/`DATABASE_URL`/`WEB_ORIGIN` в серверном `.env`
  и провижн Postgres перед `prisma migrate deploy` (см. обновлённый `deploy`-скилл).

## Блокеры

- Нет.
