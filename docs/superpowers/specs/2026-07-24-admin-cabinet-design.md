# Дизайн: кабинет Skribo (админка) — MVP

Дата: 2026-07-24
Статус: согласован (ожидает вычитки спеки)
Задача: LS-08 (кабинет), фолдит LS-07 (персистентность Postgres)

## Контекст и цель

К расширению и бэкенду добавляем **веб-кабинет**: вход по аккаунту, список/история
переговоров, карточка встречи (транскрипт + AI-саммари), базовые настройки. Референс по
структуре/UX — конкурент **Tactiq** (левый сайдбар + основная область, чистый SaaS-шелл).
Сейчас бэкенд транскрипты в БД не пишет (только WAV на диск) — кабинету нужна
персистентность, поэтому LS-07 (Postgres) входит сюда.

## Согласованные решения

1. **Объём — тонкий MVP:** вход + список/история переговоров + карточка встречи (транскрипт
   + панель AI-саммари/action items как заглушка до LS-09) + базовый профиль/настройки.
   Без billing/команд/шаринга/workflows/интеграций.
2. **Авторизация — email + пароль** (magic-link/OAuth — позже).
3. **Визуальный язык:** структура как у Tactiq (левый сайдбар + основная область), но **свой
   акцент Skribo — тёмная бирюза `#0D9488`** (не фиолетовый Tactiq). Белый шелл, скруглённые
   кнопки/карточки, тонкие бордеры, серый вторичный текст.
4. **Стек фронта — как в expeditor** (`../expeditor/apps/web`): React 19 + Vite 6 +
   React Router 7 + **Radix UI** (примитивы, обёрнутые в `src/ui`) + TanStack Table +
   Recharts; стили — **CSS Modules + Sass (`*.module.scss`)**, пишем сами, **без Tailwind**;
   общие токены/миксины — в `src/styles/`.
5. **Домен кабинета — `app.skribo.ru`** (отдельная A-запись → тот же сервер; Caddy добавит
   vhost). `api.skribo.ru` остаётся под API + WS.
6. **Привязка расширения — персональный токен:** пользователь копирует токен из
   «Настройки → Расширение» в расширение; расширение шлёт его в `start` → бэкенд связывает
   сессию с пользователем. (Логин в попапе расширения — следующий шаг.)

## Архитектура

- **`packages/admin`** (новый) — SPA кабинета: React 19 + Vite 6 + RR7 + Radix + `*.module.scss`.
  Раскладка `src/{auth,components,hooks,layout,pages,styles,ui}` (как expeditor).
- **`packages/backend`** (расширяем) — REST `/api/*`, авторизация, **Postgres через Prisma**
  (миграции), сохранение сессий/транскриптов. WS-`start` принимает персональный токен.
- **`packages/shared`** (расширяем) — доменные типы и API-DTO: `User`, `Meeting`,
  `TranscriptSegment`, `Analysis`, запрос/ответ auth и meetings.
- **Раздача (single-port, ADR-0003):** бэкенд Fastify отдаёт `admin/dist` на `app.skribo.ru`,
  API на `/api`, WS на `/ws` (`api.skribo.ru`). Caddy — reverse-proxy обоих доменов на `:3001`.

## Модель данных (Prisma / Postgres)

- **User**: `id`, `email` (unique), `passwordHash`, `name`, `createdAt`.
- **Meeting**: `id`, `userId`, `platform` (meet/zoom/teams/pachca), `title`, `startedAt`,
  `endedAt?`, `durationSec?`, `audioMode`, `participantsCount?`, `createdAt`.
- **TranscriptSegment**: `id`, `meetingId`, `speaker?`, `text`, `tsMs`, `isFinal`,
  `confidence?` — упорядоченные сегменты (для показа и будущего поиска).
- **Analysis**: `id`, `meetingId` (unique), `summary?`, `actionItems?` (JSON) — заполняется
  в LS-09; в MVP пусто.
- **PersonalToken**: `id`, `userId`, `tokenHash`, `label`, `createdAt`, `lastUsedAt?`.

## Экраны

- **`/login`, `/register`** — email+пароль; центрированная карточка, акцент Skribo.
- **App-shell** (`src/layout`): левый сайдбар (лого Skribo; **Переговоры**; **Настройки**;
  профиль внизу с выходом), основная область. Без Shared/AI-Tools/Workflows.
- **`/` — Переговоры**: поиск + сортировка (новые/старые), список карточек
  (название/платформа/дата/длительность/участники), пустое состояние. Таблица/список —
  на TanStack при необходимости.
- **`/meetings/:id` — Карточка встречи**: шапка (название/платформа/дата/длительность);
  **транскрипт** по спикерам с таймкодами; боковая/вкладочная панель **AI-саммари + action
  items** (заглушка «анализ скоро», до LS-09).
- **`/settings` — Настройки**: профиль (имя, смена пароля) + блок **«Расширение»**
  (создать/показать/скопировать персональный токен).

## API (`/api`)

- Auth: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`,
  `GET /api/auth/me`. Сессия — JWT в httpOnly-cookie; пароли — bcrypt.
- Meetings: `GET /api/meetings` (поиск/сортировка), `GET /api/meetings/:id`
  (с сегментами + analysis).
- Tokens: `POST /api/tokens`, `GET /api/tokens`, `DELETE /api/tokens/:id`.
- WS `start`: принимает `token` → резолвит `userId` → создаёт `Meeting` → финальные
  транскрипты пишутся в `TranscriptSegment`. Без валидного токена — поведение как сейчас
  (аноним, без сохранения).

## Последовательность реализации (под-планы)

1. **Фундамент: БД + авторизация + API.** Prisma/Postgres, `User`, email+пароль (`/api/auth`,
   JWT-cookie), `PersonalToken`, привязка WS-сессии по токену и сохранение `Meeting` +
   `TranscriptSegment`.
2. **SPA-шелл + auth-страницы.** `packages/admin` (Vite/RR7/Radix/scss), layout-шелл,
   `/login`+`/register`, `/settings` с токеном; деплой на `app.skribo.ru`.
3. **Список переговоров.** `GET /api/meetings` + страница `/` (поиск/сортировка/карточки).
4. **Карточка встречи.** `GET /api/meetings/:id` + `/meetings/:id` (транскрипт; заглушка анализа).

(LS-09 «анализ переговоров» — отдельно, после.)

## Границы (YAGNI)

- Без billing, команд/организаций, шаринга, workflows, интеграций, reporting, AI-tools.
- Анализ (LLM) — не в этом MVP (панель-заглушка).
- Логин в попапе расширения — позже (пока токен).
- Лендинг — отдельная задача.

## Критерии готовности

- Регистрация/вход по email+паролю работает; сессия держится (cookie).
- Расширение с персональным токеном → сессия сохраняется как `Meeting` с сегментами.
- Кабинет на `app.skribo.ru`: список переговоров и карточка встречи с транскриптом.
- Стек и стиль соответствуют expeditor-конвенции (Radix + `*.module.scss`, без Tailwind).
