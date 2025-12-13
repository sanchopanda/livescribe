Проект: Расширение для real-time транскрибации видеозвонков (Zoom / Meet / Teams)
🎯 Цель

Создать Chrome-расширение, которое захватывает аудио конференции в реальном времени, отправляет его на backend для транскрибации и отображает расшифровку пользователю.

Расширение должно работать в:

Google Meet

Zoom (web)

MS Teams (web)

1. Архитектура проекта
Chrome Extension (MV3)
├── background service worker
├── content scripts (in meeting tabs)
├── popup UI (React)
├── Audio Capture (chrome.tabCapture)
└── Audio Worklet → send PCM → backend

Backend (Node.js / Python)
├── WebSocket server for real-time audio
├── STT (OpenAI / Deepgram / Whisper)
└── returns partial transcripts

2. Функциональные модули
2.1. Расширение (Frontend)
A. Захват аудио

Использовать chrome.tabCapture (или chrome.getDisplayMedia как fallback).

Прогнать звук через AudioWorklet.

Преобразовать в 16 kHz PCM chunks.

B. Отправка аудио

WebSocket соединение с backend.

Отправка аудиочанков каждые ~100–200ms.

C. Получение стенограммы

Приём сообщений WebSocket.

Отрисовка real-time текста на popup / sidebar.

D. Детекция сервисов

Проверяем URL:

*://*.zoom.us/*
*://meet.google.com/*
*://*.teams.microsoft.com/*

E. UI расширения

React + Tailwind.

Экран статуса: подключено / запись / транскрипция.

Список сообщений real-time.

2.2. Backend
A. WebSocket сервер

Принимает аудио чанки.

Сохраняет состояние сессии.

Передаёт аудио в STT-модель.

B. STT

Выбор:

OpenAI Realtime API

Deepgram Live

Speechmatics

Whisper (через faster-whisper)

C. Возврат результата

partial transcripts

final sentences

D. Опционально

Speaker diarization

Export to: txt / md / gdoc / notion

3. Технологический стек
Расширение

Manifest V3

React + Vite

TypeScript

AudioWorklet / WebAudio API

WebSocket

Backend

Вариант 1: Node.js

ws

OpenAI Realtime / Deepgram SDK

Вариант 2: Python

websockets

faster-whisper

4. План разработки
📌 Неделя 1 — MVP аудиозахвата + отправки
4.1. Chrome extension инфраструктура

manifest.json

background SW

popup UI (React)

content script

4.2. Захват аудио

Реализовать chrome.tabCapture

Захват аудио в AudioWorklet

Конвертация в Float32 → Int16 PCM

4.3. Отправка аудио

WebSocket клиент

отправка чанков каждые 100–200ms

📌 Неделя 2 — Backend + Real-time STT
4.4. WebSocket сервер

сессии

очереди аудио чанков

отправка partial transcripts

4.5. Интеграция STT

Вариант: OpenAI Realtime API
Реализовать пайплайн:

audio chunk → STT → partial result → WebSocket → browser

📌 Неделя 3 — UI + многосервисная поддержка
4.6. Sidebar overlay в Meet/Zoom/Teams

Вставка через content script.

Фиксированный боковой блок.

Отображение live-текста.

4.7. Сроки, баги, UX

переподключение WebSocket

индикатор уровня громкости

старт/стоп кнопки

📌 Неделя 4 — Диаризация / Экспорт / Монетизация
4.8. Диаризация

Опции:

Deepgram native speaker detection

pyannote (медленно → не real-time)

4.9. Экспорт

Markdown

TXT

Google Docs API

Notion API

4.10. Dashboard

учёт сессий

авторизация

Stripe billing

5. API Контракты
WebSocket (client → server)
{
  type: "audio",
  sampleRate: 16000,
  chunk: <ArrayBuffer PCM16>
}

WebSocket (server → client)

Partial:

{
  type: "partial",
  text: "Привет, как дела"
}


Final:

{
  type: "final",
  text: "Привет, как дела."
}

6. Файловая структура (Frontend)
extension/
│ manifest.json
│ vite.config.js
│
├── src/
│   ├── background/
│   │   └── service-worker.ts
│   ├── content/
│   │   └── inject-ui.ts
│   ├── audio/
│   │   ├── recorder.ts
│   │   └── processor.worklet.js
│   ├── popup/
│   │   ├── App.tsx
│   │   └── index.tsx
│   └── ws/
│       └── client.ts

7. Файловая структура (Backend)
backend/
│ server.js
│ stt.js
│ ws.js
│ package.json

8. MVP критерии готовности

Расширение захватывает звук со звонка.

Аудио отправляется на backend.

Backend отдаёт real-time транскрипцию.

Текст отображается в overlay.