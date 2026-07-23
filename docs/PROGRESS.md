# PROGRESS — курсор состояния

Обновлять на каждой логической точке (см. [`CONVENTIONS.md`](CONVENTIONS.md)).
Истина статуса = состояние git (коммит в `main`).

## Сделано (последнее)

- Meet per-track WebRTC-пайплайн (`ea04f9c`).
- STT сведён к одному Deepgram (`245436c`, ADR-0001).
- dev-flow: скиллы `proceed`/`implement-task`/`test-task`/`review-task`/`release`,
  конвенции документации, `CHANGELOG.md`.

## Следующее

- **LS-06 — Хостинг бэкенда** (Yandex Cloud) + ADR-0002 (верхний кандидат из
  [`backlog.md`](backlog.md)). Продуктовое направление: хостинг → Postgres → лендинг/админка
  → анализ; покрытие платформ (Zoom/Teams per-track) сдвинуто ниже.

## Задача в работе

- **LS-06 — Хостинг бэкенда.** Решения зафиксированы: ADR-0002 (**Beget**, Москва,
  Caddy TLS/wss, systemd, Postgres на ВМ), домены — `api.skribo.ru` (сейчас) + `skribo.io`
  (бренд позже). Продукт переименован в **Skribo** (ADR-0004).
  - ✅ Код-подготовка: WS-URL расширения вынесен в build-time конфиг (Vite `define` `__WS_URL__`).
  - ✅ Сервер Beget поднят: `45.147.176.79`, Ubuntu 24.04, Node 20; вход по ключу.
  - ✅ Backend задеплоен: rsync → `npm install` → сборка shared+backend; systemd
    `skribo-backend` (active, `:3001`); WS-хендшейк отвечает `101`.
  - ✅ Caddy установлен, `Caddyfile` (`api.skribo.ru` → `127.0.0.1:3001`) готов; держим
    остановленным до DNS.
  - ⏳ **Блокер: A-запись `api.skribo.ru` → `45.147.176.79`** (панель Beget) — без неё нет TLS.
  - ⏳ После DNS: старт Caddy → авто-TLS → пост-проверка `wss://api.skribo.ru/ws`; затем
    прод-сборка расширения (`WS_URL=wss://api.skribo.ru/ws`) и сужение CORS.
  - 🔒 Безопасность: root-пароль засветился в чате — сменить и отключить парольный вход
    (ключ уже работает).

## Блокеры

- Нет.
