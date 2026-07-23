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
  - ✅ Код-подготовка: WS-URL расширения вынесен в build-time конфиг (Vite `define`
    `__WS_URL__`); прод-сборка `WS_URL=wss://api.skribo.ru/ws` проверена.
  - ⏳ Ждём от владельца: регистрацию `skribo.ru` и создание VPS на Beget (IP + ssh + IPv4).
  - ⏳ Дальше: `deploy`-скилл, Caddy/systemd, сужение CORS, пост-проверка `wss`.

## Блокеры

- Нет.
