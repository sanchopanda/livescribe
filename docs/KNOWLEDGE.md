# KNOWLEDGE — живые заметки

Тонкая база знаний: глоссарий, грабли и указатели. Обзор проекта и архитектура —
в [`../AGENTS.md`](../AGENTS.md) (здесь не дублируем).

## Глоссарий

- **mixed** — классический захват аудио всей вкладки через `chrome.tabCapture`.
- **per-track** — покомпонентный захват отдельных WebRTC-треков участников. Реализован
  для **Pachca** и **Google Meet**.
- **MAIN-world hook** — скрипт в MAIN-мире страницы, перехватывающий WebRTC и регистрирующий
  remote audio-треки (`webrtc-tracks-main.ts`).
- **VAD** — voice activity detection: определяет речь по RMS/peak, чтобы не гнать тишину.
- **session** — сессия транскрипции: `start` → поток `audio`-чанков → `stop` (см. WebSocket
  Protocol в AGENTS.md).
- **STT** — speech-to-text. Единственный провайдер — **Deepgram** (см.
  [`decisions/0001-stt-deepgram-only.md`](decisions/0001-stt-deepgram-only.md)).

## Грабли

- **type-check — гейт.** `npm run type-check` должен быть зелёным перед коммитом (собирает
  shared → проверяет backend/extension/shared). `lint` в проекте сейчас сломан (ESLint v9
  без `eslint.config.js`) — на него не опираться.
- **Домены платформ — один источник.** `packages/extension/src/platform/hosts.ts`: из него
  генерятся `content_scripts.matches` (сборка в `vite.config.ts`), рантайм-детектор
  `platform-detector.ts` и store-`host_permissions`. В `public/manifest.json` списка доменов
  больше нет — `content_scripts` там пустой массив, его заполняет конфиг. Тест
  `hosts.test.ts` падает, если детектор и `matches` разъехались.
  Грабля, из-за которой это сделано: Teams переехал на `teams.cloud.microsoft`, домен добавили
  только в детектор — виджет не открывался, а фолбэк с инъекцией молча падал, потому что
  `content.js` не был web-accessible для нового хоста. `*.cloud.microsoft` вайлдкардом не
  брать: это общий домен всего Microsoft 365.
- **Новая платформа** — добавить запись в `PLATFORM_HOSTS`, при необходимости MAIN-world
  скрипт в `contentScripts()` и entry в `rollupOptions.input`.
- **Пороги per-track VAD** (дефолты): `rmsOn=0.02`, `rmsOff=0.01`, `peakOverride=0.12`,
  hangover `1000ms` — в `content/per-track/core/vad.ts`; pre-roll `1500ms` (буфер до открытия
  гейта, чтобы не срезать начало речи) вместе с самим кольцевым буфером — в
  `content/per-track/core/pre-roll.ts`. Оба общие для всех платформ: раньше `PRE_ROLL_MS` был
  продублирован в meet- и pachca-транскрайберах и мог разъехаться.
- **Speaker labeling** — сейчас DOM-only (имена участников из DOM платформы). Экспериментальные
  WebRTC/диаризация — в [`SPEAKER_DETECTION_ARCHIVE.md`](SPEAKER_DETECTION_ARCHIVE.md).

## Указатели

- Захват аудио: [`audio-capture-methods.md`](audio-capture-methods.md).
- Поведение соединения/восстановление: [`connection-behavior.md`](connection-behavior.md).
- Тайминг разрешений: [`permissions-timing.md`](permissions-timing.md).
- Правила ведения доков: [`CONVENTIONS.md`](CONVENTIONS.md).
