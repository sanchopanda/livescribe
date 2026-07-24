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

## Следующее

- **LS-08 sub-plan 2 — SPA-шелл + auth-страницы** (`packages/admin`: React/Vite/RR7/Radix/
  `*.module.scss`; layout, `/login`+`/register`, `/settings` с токеном; деплой на `app.skribo.ru`).
  Затем sub-plan 3 (список переговоров) и 4 (карточка встречи).

## Задача в работе

- Нет (между под-планами). 22+ коммитов не запушены в `origin`.

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
