---
name: deploy
description: >-
  Выкатить бэкенд Skribo на VPS (Beget, api.skribo.ru): rsync исходников → сборка на
  сервере → рестарт systemd → пост-проверка wss. Caddy даёт TLS. ВНЕ обычного флоу:
  запускать ТОЛЬКО по явной просьбе пользователя задеплоить/выкатить на сервер.
---

# deploy — выкатка бэкенда на сервер

**ЖЁСТКО: только по явной просьбе.** Мерж/коммит в `main` — не сигнал к деплою.

## Что на сервере (факты)

- Хост: `root@45.147.176.79` (Ubuntu 24.04), вход по SSH-ключу (`~/.ssh/id_rsa`).
- Node 20 (NodeSource), build-essential+python3 (для нативного `@discordjs/opus`).
- Код: `/root/skribo` (полное монорепо, исходники + node_modules + dist).
- Запуск: systemd-сервис **`skribo-backend`** → `node dist/index.js`, WorkingDirectory
  `/root/skribo/packages/backend`, слушает `:3001` (env `WS_PORT`).
- Прод-секреты: `/root/skribo/packages/backend/.env` (`DEEPGRAM_API_KEY`, `DEEPGRAM_MODEL`,
  `WS_PORT`, `STT_PROVIDER`, `DATABASE_URL`, `JWT_SECRET`, `WEB_ORIGIN`, `NODE_ENV=production`)
  — **не перезаписывать rsync-ом**. Бэкенд отказывается стартовать в проде без
  `JWT_SECRET`/`DATABASE_URL`.
- TLS/reverse-proxy: **Caddy**, `/etc/caddy/Caddyfile` (`api.skribo.ru` → `127.0.0.1:3001`),
  авто-Let's Encrypt. Слушает 80/443.
- Домен: `api.skribo.ru` (A-запись на reg.ru, NS `ns*.reg.ru`).

## База данных (Postgres)

На сервере должен быть провижен Postgres (managed БД от Beget либо локальный Postgres на
ВМ) **до** `prisma migrate deploy` — иначе миграция упадёт. `DATABASE_URL` в `.env` должен
указывать на него.

## Пред-условия

- Локально: `npm run type-check` и `npm run build` зелёные.
- `api.skribo.ru` резолвится в IP сервера (иначе Caddy не выпустит TLS).
- Postgres на сервере провижен, `DATABASE_URL` в `.env` настроен.
- Пользователь явно попросил деплой.

## Шаги

1. **rsync исходников** (исключить сборочный мусор и секреты — **обязательно `*.tsbuildinfo`**,
   иначе инкрементальный `tsc` на сервере не сэмитит `dist`):
```bash
SSHOPT="-i ~/.ssh/id_rsa -o BatchMode=yes -o StrictHostKeyChecking=accept-new"
rsync -az -e "ssh $SSHOPT" \
  --exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude '.env' \
  --exclude 'packages/stt-service' --exclude '*.log' --exclude '.vite' \
  --exclude '.claude' --exclude 'scratchpad' \
  /home/aleksander/code/livescribe/ root@45.147.176.79:/root/skribo/
```

2. **Сборка на сервере** (чистим stale buildinfo → shared → backend). `npm install` сам
   прогонит `postinstall: prisma generate` в `packages/backend` — Prisma-клиент
   регенерируется на каждую установку зависимостей:
```bash
ssh $SSHOPT root@45.147.176.79 '
  set -e
  cd /root/skribo
  npm install --no-audit --no-fund
  find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete
  npm run build --workspace=@livescribe/shared
  npm run build --workspace=@livescribe/backend
'
```

3. **Прогон миграций БД** (после сборки, перед рестартом сервиса):
```bash
ssh $SSHOPT root@45.147.176.79 '
  cd /root/skribo/packages/backend
  npx prisma migrate deploy
'
```

4. **Рестарт сервиса + пост-проверка:**
```bash
ssh $SSHOPT root@45.147.176.79 '
  systemctl restart skribo-backend
  sleep 2
  systemctl is-active skribo-backend
  ss -ltn | grep :3001
'
```

## Пост-проверка (обязательно — «проверяй перед тем как звать смотреть»)

```bash
# WSS снаружи (HTTP/1.1! иначе curl уходит в HTTP/2 и даёт 404 — это артефакт):
timeout 12 curl -s -o /dev/null -w "%{http_code}\n" --http1.1 --max-time 8 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Sec-WebSocket-Version: 13" \
  https://api.skribo.ru/ws     # ждём 101
```
Готовность = сервис active, `:3001` слушает, `wss://api.skribo.ru/ws` отвечает `101`.

## Первичная настройка сервера (если ВМ новая)

Node 20 (`deb.nodesource.com/setup_20.x`), `apt-get install nodejs build-essential python3
rsync`; Caddy (репо cloudsmith) + `/etc/caddy/Caddyfile`; systemd-юнит `skribo-backend`;
`.env` с ключом Deepgram. См. историю LS-06 / ADR-0002.

## Кабинет (admin SPA) на `app.skribo.ru`

Раздаётся тем же Caddy на отдельном домене `app.skribo.ru` (A-запись на reg.ru → IP сервера),
single-origin: статика SPA + прокси `/api` на бэкенд.

Провижн (один раз): `apt-get install postgresql` на ВМ; создать роль/БД `skribo`; в серверном
`.env` (`packages/backend/.env`) — `DATABASE_URL=postgresql://skribo:<pass>@localhost:5432/skribo?schema=public`,
`JWT_SECRET=<rand>`, `NODE_ENV=production`, `WEB_ORIGIN=https://app.skribo.ru`. Caddy бежит под
юзером `caddy` и НЕ читает `/root`, поэтому статику кладём в `/var/www/skribo-admin`.

На каждый деплой кабинета (после общего билда):
```bash
ssh $SSHOPT root@45.147.176.79 '
  cd /root/skribo
  npm run build --workspace=@livescribe/admin
  mkdir -p /var/www/skribo-admin && rm -rf /var/www/skribo-admin/*
  cp -r packages/admin/dist/* /var/www/skribo-admin/
  chmod -R a+rX /var/www/skribo-admin; chmod a+rX /var/www
'
```
Caddyfile (vhost кабинета; `api.skribo.ru` — как раньше):
```
app.skribo.ru {
	handle /api/* { reverse_proxy 127.0.0.1:3001 }
	handle { root * /var/www/skribo-admin; try_files {path} /index.html; file_server }
}
```
Пост-проверка: `curl https://app.skribo.ru/login` → 200 (SPA), `https://app.skribo.ru/api/auth/me` → 401.

## ⚠️ Урок: при изменении бэкенда — пересобрать И перезапустить

Правка кабинета (`admin`) НЕ обновляет бэкенд. Если менялся `packages/backend` (или `shared`),
после rsync обязательно: `npm run build --workspace=@livescribe/shared && ... --workspace=@livescribe/backend`
и `systemctl restart skribo-backend`. Иначе новые эндпоинты отвечают `404` (старый `dist/`),
как было с `/api/auth/extension-login` — деплой кабинета обновил только `admin`, бэкенд остался
старым. Проверка: `curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3001/api/auth/extension-token` → `401`, не `404`.

## Расширение под прод

Клиент подключается к бэкенду по адресу из build-time конфига:
```bash
WS_URL=wss://api.skribo.ru/ws npm run build:extension
```
Дефолт (без `WS_URL`) — `ws://localhost:3001/ws` для локальной разработки.
