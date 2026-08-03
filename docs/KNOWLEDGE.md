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
- **Teams сводит звук на сервере — per-track невозможен** (разведка 2026-08-03,
  `teams.cloud.microsoft`, 3+ участника, 3 снимка за 10 мин). Один активный peer-connection,
  `audioReceivers: 1`, единственный `inbound-rtp`: `ssrc 67003`,
  `trackIdentifier: "mainAudio-67003"`. Решающий признак: **при смене говорящего** (Gevorg →
  Dmitriy) `ssrc`/`mid`/число ресиверов не изменились, пакеты росли на том же потоке
  (+17 297 за 10:17, `audioLevel` 0.09 → 0.40 → 0.56). При per-track ресиверы заводятся на
  **каждого отправляющего** участника (как у Meet/Pachca), а не на текущего говорящего.
  Привязки трека к DOM тоже нет: ни один из 882 элементов не содержит `ssrc`/`trackIdentifier`,
  аналога `data-ssrc` от Meet у Teams нет. Вывод: Teams — mixed + speaker-DOM.
- **DOM участника в Teams**: плитка — `[data-cid="calling-participant-stream"]`, имя в
  `aria-label`, UPN в `data-tid`, тип потока в `data-stream-type` (`Video` / `ScreenSharing`).
  У одного участника может быть **несколько плиток** (видео + шаринг), и у шаринга `aria-label`
  другого формата: «Общий контент от пользователя X».
- **Спикер в mixed — по времени сегмента, не по времени доставки.** Deepgram отдаёт результат
  через 0.5–3 с после произнесённого, и «взять того, кто говорит сейчас» мажет мимо на каждой
  смене говорящего. Сессия ведёт таймлайн смен (`websocket/speaker-timeline.ts`) с **серверными**
  метками приёма — так не нужна синхронизация часов с клиентом, а лаг WS (десятки мс) на порядок
  меньше лага STT. Сегмент кладётся на таймлайн через `startSec` из Deepgram + время первого
  аудио-чанка; допуск `SPEAKER_LOOKAHEAD_MS = 750` — на запаздывание DOM-индикатора речи.
  Пересчёт offset → wall-clock верен, пока аудио идёт непрерывно в реальном времени (mixed);
  для per-track это не нужно — там спикер приходит вместе с дорожкой.
- **Speaker labeling** — сейчас DOM-only (имена участников из DOM платформы). Экспериментальные
  WebRTC/диаризация — в [`SPEAKER_DETECTION_ARCHIVE.md`](SPEAKER_DETECTION_ARCHIVE.md).

## Указатели

- Захват аудио: [`audio-capture-methods.md`](audio-capture-methods.md).
- Поведение соединения/восстановление: [`connection-behavior.md`](connection-behavior.md).
- Тайминг разрешений: [`permissions-timing.md`](permissions-timing.md).
- Правила ведения доков: [`CONVENTIONS.md`](CONVENTIONS.md).
