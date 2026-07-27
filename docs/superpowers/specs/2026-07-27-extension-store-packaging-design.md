# Дизайн: упаковка расширения под Chrome Web Store (LS-05)

Дата: 2026-07-27
Статус: согласован

## Контекст и цель

Расширение технически готово, но не упаковано под публикацию: нет иконок, `manifest` содержит
dev-остатки (`<all_urls>`, `localhost`, исследовательский `platform-research`), нет privacy
policy и гайда по дашборду. Цель LS-05 — довести до состояния, когда можно собрать zip и
подать в Chrome Web Store.

## Ключевые решения

1. **Иконка** — сгенерированная монограмма («S», белая, на скруглённом квадрате `#0d9488`),
   размеры 16/48/128. Генерится скриптом (PIL, `load_default(size)` — проверено, рендерит
   читаемую «S»); PNG коммитятся. Реальный логотип — позже (плейсхолдер сейчас).
2. **Платформы публичного релиза** — Meet / Zoom / Teams / Pachca. Store-сборка убирает
   `<all_urls>`, `localhost`, YouTube.
3. **Dev vs store — один manifest-объект**, `vite.config` при `EXT_TARGET=store` программно
   сужает права/matches и вырезает `platform-research`. Dev-сборка остаётся широкой (удобство).
4. **Privacy policy** — публичный роут `/privacy` в кабинете (React-страница, деплоится с admin)
   → URL `https://app.skribo.ru/privacy` для дашборда.
5. Заливка/оплата/скриншоты/data-disclosures в дашборде — на пользователе; в гайде — что и как.

## Архитектура

### Иконки

- `packages/extension/scripts/gen-icons.py` — PIL: рисует скруглённый квадрат `#0d9488` + белую
  «S» (`ImageFont.load_default(size≈88)`), сохраняет `public/icons/icon-128.png`, ресайзит
  (LANCZOS) в 48 и 16. PNG **коммитятся** (Python нужен только для регенерации).
- В **базовый** `manifest.json`: `"icons": {16,48,128}` и `"action".default_icon` (в dev и store).

### Store-таргет сборки (`packages/extension/vite.config.ts`)

- Читать `EXT_TARGET` (env). При `=== 'store'` — клонировать импортированный manifest и:
  - `host_permissions` → `['https://api.skribo.ru/*','https://app.skribo.ru/*',
    'https://meet.google.com/*','https://zoom.us/*','https://*.zoom.us/*',
    'https://teams.microsoft.com/*','https://*.teams.microsoft.com/*',
    'https://*.pachca.com/*','https://app.pachca.com/*']` (убрать `<all_urls>`, `localhost`);
  - из `content_scripts` убрать запись `platform-research` (MAIN-world инструментация) и убрать
    `youtube` из `matches` у `content.js`;
  - опц.: в store-режиме не добавлять `platform-research` в `rollupOptions.input` (чтобы не
    собирать неиспользуемый файл).
  - передать этот клон в `crx({ manifest })`.
- Dev (по умолчанию, без `EXT_TARGET=store`) — без изменений.

### Pack-скрипт

- `scripts/pack-extension.sh` — прод-URL (`WS_URL=wss://api.skribo.ru/ws
  API_URL=https://api.skribo.ru CABINET_URL=https://app.skribo.ru`) + `EXT_TARGET=store`
  → `npm run build:extension` → zip содержимого `packages/extension/dist` в
  `skribo-extension-<version>.zip` (версия из manifest). npm-скрипт `pack:extension` в корне.

### Privacy policy (кабинет)

- `packages/admin/src/pages/PrivacyPage.tsx` — статическая RU-страница политики
  (что собираем: аудио звонков, транскрипты, email/имя, метаданные встреч; обработка: наш
  бэкенд + Deepgram (STT) + OpenRouter (анализ/саммари по запросу); хранение: наш Postgres,
  привязано к аккаунту; live-саммари эфемерно; не продаём; удаление — в кабинете/по запросу;
  согласие участников — на пользователе; контакт; дата). Публичный роут `/privacy` в `main.tsx`
  (вне `ProtectedRoute`).

### Гайд

- `docs/guides/chrome-web-store.md` — чек-лист: аккаунт+$5; команда `pack:extension`; тексты
  обоснований прав (`tabCapture`/`offscreen`/`scripting`/`storage`/`alarms`/`activeTab`) и хостов;
  data-usage disclosures; нужные ассеты (иконка 128, ≥1 скриншот 1280×800); privacy URL;
  ожидания по ревью (`tabCapture` + аудио → тщательно, не мгновенно).

## Границы (YAGNI)

- Скриншоты листинга/промо-тайл — пользователь (в гайде — требования, фейки не генерим).
- Реальный логотип — позже.
- Сама подача/публикация/дашборд — пользователь.
- Рантайм-ребренд `livescribe-*` (DOM/storage/логи) — вне LS-05 (follow-up LS-10).

## Критерии готовности

- Store-сборка (`npm run pack:extension`) даёт `skribo-extension-<version>.zip`; в
  `dist/manifest.json` **нет** `<all_urls>`, `localhost`, `platform-research`, YouTube; **есть**
  `icons` (файлы присутствуют) и суженные хосты/matches.
- Dev-сборка (`npm run build:extension` без флага) не сломана — с прежними широкими правами.
- `/privacy` открывается в кабинете (после деплоя — `https://app.skribo.ru/privacy`).
- Гайд покрывает все поля дашборда. `type-check` + сборки зелёные.

## Вне объёма (follow-up)

- Реальный логотип; локализация листинга (EN); скриншоты; сама публикация.
- Верификация домена/DNS для почты — в LS-12.
