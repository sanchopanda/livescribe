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
- [ ] LS-12 — **Email-инфраструктура и восстановление пароля.** Сейчас нет: отправки писем,
  верификации email, сброса пароля («забыли пароль»). Нужны SMTP/почтовый сервис,
  `/api/auth/forgot` + `/reset` (токен по email), опц. подтверждение email при регистрации.
- [ ] LS-09 — **Анализ переговоров.** LLM-API поверх истории транскриптов в админке
  (саммари, ключевые моменты, поиск).
- [ ] LS-13 — **Self-host RU-STT (GigaAM / Parakeet)** — *плановая, gated на триггеры*
  (см. ADR-0005: качество RU / 152-ФЗ / объём / офлайн). Приоритет GigaAM-v3 (MIT, лучший
  русский), альтернатива — Parakeet Nemotron-Streaming. Добавляется провайдером к
  `STTProvider` (GPU-микросервис). Шаги: бенчмарк RU-качества + латентности стриминга на
  реальных звонках → GPU-сайзинг/цена → провайдер `gigaam` → A/B vs Deepgram. Ресёрч:
  `docs/research/2026-07-26-stt-models-parakeet-gigaam.md`.

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
- [ ] LS-05 — **Упаковка расширения.** Сборка zip для Chrome Web Store, проверка manifest
  и прав; шаги в `docs/guides/`.
- [ ] LS-10 — **Ребрендинг livescribe → Skribo.** Механическое переименование
  идентификаторов пакетов (`@livescribe/*` → `@skribo/*`), имя репозитория, алиасы
  `vite.config`/`tsconfig`, оставшиеся упоминания в коде/доках. Одним отревьюенным проходом
  (см. ADR-0004).
