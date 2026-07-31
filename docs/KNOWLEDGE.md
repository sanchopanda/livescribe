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
- **manifest matches.** При добавлении новой платформы обновлять список `matches` и
  регистрацию MAIN-world скриптов в `packages/extension/public/manifest.json` и entry в
  `vite.config.ts`.
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
