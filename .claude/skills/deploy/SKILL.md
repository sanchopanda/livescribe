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
  `WS_PORT`, `STT_PROVIDER`) — **не перезаписывать rsync-ом**.
- TLS/reverse-proxy: **Caddy**, `/etc/caddy/Caddyfile` (`api.skribo.ru` → `127.0.0.1:3001`),
  авто-Let's Encrypt. Слушает 80/443.
- Домен: `api.skribo.ru` (A-запись на reg.ru, NS `ns*.reg.ru`).

## Пред-условия

- Локально: `npm run type-check` и `npm run build` зелёные.
- `api.skribo.ru` резолвится в IP сервера (иначе Caddy не выпустит TLS).
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

2. **Сборка на сервере** (чистим stale buildinfo → shared → backend):
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

3. **Рестарт сервиса + пост-проверка:**
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

## Расширение под прод

Клиент подключается к бэкенду по адресу из build-time конфига:
```bash
WS_URL=wss://api.skribo.ru/ws npm run build:extension
```
Дефолт (без `WS_URL`) — `ws://localhost:3001/ws` для локальной разработки.
