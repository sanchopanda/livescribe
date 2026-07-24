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

## Следующее

- **LS-08 sub-plan 3 — Страница списка переговоров** (`GET /api/meetings` уже есть → UI
  списка: поиск/сортировка/карточки). Затем sub-plan 4 (карточка встречи с транскриптом).

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
