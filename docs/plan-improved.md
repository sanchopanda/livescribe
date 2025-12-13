# Проект: LiveScribe - Real-time транскрибация видеозвонков

## Обзор

Chrome-расширение (MV3) для захвата аудио из видеоконференций в реальном времени, передачи на backend для STT и отображения транскрипции пользователю.

**Поддерживаемые платформы:**
- Google Meet
- Zoom (web)
- MS Teams (web)

---

## 1. Архитектура

### 1.1. Chrome Extension (Manifest V3)

```
Chrome Extension
├── Background Service Worker
│   ├── Управление жизненным циклом
│   ├── Координация между компонентами
│   └── Хранилище состояния
├── Content Scripts
│   ├── Детекция платформы (Meet/Zoom/Teams)
│   ├── Инжект UI overlay
│   └── Управление DOM
├── Audio Capture
│   ├── chrome.tabCapture API
│   ├── AudioContext + AudioWorklet
│   └── PCM encoding (16kHz, mono, Int16)
├── WebSocket Client
│   ├── Бинарная передача аудио
│   ├── Auto-reconnect logic
│   └── Heartbeat/keepalive
└── Popup/Sidebar UI (React)
    ├── Статус соединения
    ├── Real-time транскрипция
    ├── Настройки (язык, STT provider)
    └── Экспорт результатов
```

### 1.2. Backend Server

```
Backend
├── WebSocket Server
│   ├── Session management
│   ├── Audio streaming handling
│   └── Connection pooling
├── STT Service
│   ├── OpenAI Realtime API
│   ├── Deepgram Live API
│   ├── Whisper (faster-whisper)
│   └── Языковая модель (multi-language)
├── API Gateway
│   ├── REST endpoints (auth, settings)
│   ├── Rate limiting
│   └── API key management
├── Database
│   ├── User accounts
│   ├── Session metadata
│   └── Billing records
└── Storage
    ├── Raw audio files (optional)
    └── Transcript archives
```

---

## 2. Технологический стек

### Frontend (Extension)
- **Framework:** React 18 + TypeScript
- **Build:** Vite + vite-plugin-web-extension
- **Styling:** Tailwind CSS
- **State:** Zustand / Jotai (легковесное)
- **Audio:** Web Audio API + AudioWorklet
- **WebSocket:** native WebSocket API
- **Testing:** Vitest + Playwright

### Backend
**Option A: Node.js**
- Runtime: Node.js 20+
- Framework: Fastify / Express
- WebSocket: `ws` library
- STT: OpenAI SDK / Deepgram SDK
- DB: PostgreSQL + Prisma ORM
- Auth: JWT + refresh tokens

**Option B: Python**
- Runtime: Python 3.11+
- Framework: FastAPI
- WebSocket: `websockets` / `python-socketio`
- STT: faster-whisper / openai-python
- DB: PostgreSQL + SQLAlchemy
- Auth: JWT + OAuth2

### Infrastructure
- Hosting: Railway / Render / AWS
- CDN: Cloudflare (для статики расширения)
- Storage: S3-compatible (для архивов)
- Monitoring: Sentry + LogRocket

---

## 3. Детальный дизайн модулей

### 3.1. Audio Capture (Extension)

**Требования:**
- Разрешение `"tabCapture"` в manifest.json
- User gesture для инициации захвата
- Fallback на `getDisplayMedia` если tabCapture недоступен

**Алгоритм:**
1. Получить `MediaStream` через `chrome.tabCapture`
2. Создать `AudioContext` (16kHz sample rate)
3. Подключить `AudioWorkletProcessor`
4. В worklet: конвертировать Float32 → Int16 PCM
5. Отправить chunks (100-200ms) в WebSocket

**Обработка ошибок:**
- Нет разрешения → запросить у юзера
- Вкладка неактивна → показать уведомление
- Аудио недоступно → показать troubleshooting

### 3.2. Platform Detection

Детекция по URL patterns:

```typescript
const PLATFORM_PATTERNS = {
  zoom: /^https?:\/\/.*\.zoom\.us\/.*/,
  meet: /^https?:\/\/meet\.google\.com\/.*/,
  teams: /^https?:\/\/.*\.teams\.microsoft\.com\/.*/,
};
```

**Специфика платформ:**
- **Zoom:** работает в web client, native app недоступен
- **Meet:** нужен inject в shadow DOM
- **Teams:** может требовать дополнительные permissions

### 3.3. WebSocket Protocol

#### Client → Server

**Audio Chunk:**
```json
{
  "type": "audio",
  "sessionId": "uuid-v4",
  "sampleRate": 16000,
  "channels": 1,
  "chunk": "<base64 или binary PCM>"
}
```

**Control Messages:**
```json
{
  "type": "start",
  "language": "ru-RU",
  "platform": "meet"
}
```

```json
{
  "type": "stop"
}
```

#### Server → Client

**Partial Transcript:**
```json
{
  "type": "partial",
  "text": "Привет как дела",
  "timestamp": 1234567890,
  "confidence": 0.85
}
```

**Final Transcript:**
```json
{
  "type": "final",
  "text": "Привет, как дела?",
  "timestamp": 1234567890,
  "confidence": 0.92,
  "speaker": "Speaker 1"
}
```

**Error:**
```json
{
  "type": "error",
  "code": "STT_FAILED",
  "message": "Speech-to-text service unavailable"
}
```

### 3.4. STT Integration

**Выбор провайдера:**

| Provider | Latency | Cost | Diarization | Multi-lang |
|----------|---------|------|-------------|------------|
| OpenAI Realtime | ~300ms | $$ | ❌ | ✅ |
| Deepgram Live | ~200ms | $ | ✅ | ✅ |
| Whisper (self-hosted) | ~500ms | Free* | ❌ | ✅ |

**Рекомендация:** Deepgram для MVP (баланс цены/качества)

### 3.5. UI/UX

**Popup (браузерный action):**
- Статус: Inactive / Recording / Connected
- Кнопка Start/Stop
- Настройки (язык, provider)
- Ссылка на dashboard

**Overlay (injected в страницу):**
- Фиксированная позиция (справа/слева)
- Минимизируемый sidebar
- Live transcript scroll
- Индикатор уровня звука (volume meter)
- Кнопка копировать / экспорт

---

## 4. Безопасность и приватность

### 4.1. Consent & Legal
- ⚠️ **КРИТИЧНО:** Пользователь должен получить согласие всех участников перед записью
- Показать disclaimer при первом запуске
- Соответствие GDPR / CCPA
- Не записывать автоматически при старте

### 4.2. Data Security
- WSS (WebSocket Secure) для передачи
- Опциональное E2E шифрование аудио
- Не хранить raw audio на сервере дольше 24ч
- Шифрование транскриптов в БД
- Регулярная очистка старых данных

### 4.3. Authentication
- API key для backend access
- JWT tokens (access + refresh)
- Rate limiting по IP и по user
- CORS настройки (только extension origin)

---

## 5. План разработки (фазы)

### 🟢 Фаза 1: Минимальная инфраструктура

**Extension:**
- [ ] Scaffold проекта (Vite + React + TypeScript)
- [ ] Manifest V3 базовая конфигурация
- [ ] Background service worker setup
- [ ] Popup UI скелет (без функционала)

**Backend:**
- [ ] WebSocket сервер (базовая эхо-логика)
- [ ] Docker setup для локальной разработки
- [ ] Health check endpoints

**Deliverable:** Extension устанавливается, popup открывается, WebSocket соединение устанавливается

---

### 🟡 Фаза 2: Audio Capture MVP

**Extension:**
- [ ] Реализация chrome.tabCapture
- [ ] AudioContext + AudioWorklet processor
- [ ] Float32 → Int16 PCM конвертация
- [ ] Отправка audio chunks в WebSocket (binary)
- [ ] UI: кнопка Start/Stop, индикатор статуса

**Backend:**
- [ ] Приём бинарных аудио chunks
- [ ] Сохранение в WAV (для тестирования)
- [ ] Логирование метрик (latency, chunk size)

**Deliverable:** Аудио захватывается со звонка и передается на сервер

---

### 🟠 Фаза 3: Real-time STT

**Backend:**
- [ ] Интеграция с Deepgram Live API (или OpenAI)
- [ ] Pipeline: audio chunk → STT → partial/final
- [ ] Отправка транскриптов обратно в WebSocket
- [ ] Error handling для STT failures

**Extension:**
- [ ] Приём partial/final транскриптов
- [ ] Отображение в UI (live update)
- [ ] Auto-scroll транскрипции

**Deliverable:** Полный цикл: захват → передача → транскрипция → отображение

---

### 🔵 Фаза 4: Platform Support

**Extension:**
- [ ] Content script для Google Meet
- [ ] Content script для Zoom
- [ ] Content script для Teams
- [ ] Детекция платформы по URL
- [ ] Inject overlay UI в каждую платформу
- [ ] Адаптация под разные DOM структуры

**Testing:**
- [ ] E2E тесты на каждой платформе
- [ ] Проверка permissions

**Deliverable:** Расширение работает на всех трех платформах

---

### 🟣 Фаза 5: Production Readiness

**Extension:**
- [ ] Reconnection logic для WebSocket
- [ ] Buffering при потере соединения
- [ ] Индикатор качества соединения
- [ ] Настройки: язык, провайдер STT
- [ ] Экспорт транскриптов (txt, md)

**Backend:**
- [ ] Rate limiting (по IP и по user)
- [ ] Authentication (API keys)
- [ ] PostgreSQL для сессий/пользователей
- [ ] Logging/monitoring (Sentry)
- [ ] Auto-cleanup старых данных

**Deliverable:** Стабильная система, готовая к использованию

---

### 🔴 Фаза 6: Advanced Features

**Features:**
- [ ] Speaker diarization (кто говорит)
- [ ] Multi-language auto-detection
- [ ] Экспорт в Google Docs / Notion
- [ ] Dashboard для истории сессий
- [ ] Search по транскриптам
- [ ] Highlight ключевых моментов (AI summary)

**Business:**
- [ ] User accounts (регистрация/логин)
- [ ] Stripe integration (billing)
- [ ] Free tier (X минут/месяц)
- [ ] Paid tiers

**Deliverable:** Full-featured продукт с монетизацией

---

## 6. Файловая структура

### Extension

```
extension/
├── manifest.json
├── vite.config.ts
├── tailwind.config.js
├── package.json
├── src/
│   ├── background/
│   │   ├── service-worker.ts       # SW entry point
│   │   └── session-manager.ts      # Session state
│   ├── content/
│   │   ├── index.ts                # Content script main
│   │   ├── platforms/
│   │   │   ├── meet.ts
│   │   │   ├── zoom.ts
│   │   │   └── teams.ts
│   │   └── overlay/
│   │       ├── TranscriptPanel.tsx
│   │       └── styles.css
│   ├── audio/
│   │   ├── capture.ts              # chrome.tabCapture logic
│   │   ├── processor.worklet.ts    # AudioWorklet
│   │   └── encoder.ts              # PCM encoding
│   ├── websocket/
│   │   ├── client.ts               # WS connection
│   │   └── protocol.ts             # Message types
│   ├── popup/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── StatusIndicator.tsx
│   │   │   ├── ControlPanel.tsx
│   │   │   └── SettingsForm.tsx
│   │   └── index.tsx
│   ├── store/
│   │   └── state.ts                # Global state (Zustand)
│   └── utils/
│       ├── logger.ts
│       └── constants.ts
└── public/
    ├── icons/
    └── assets/
```

### Backend

```
backend/
├── package.json / requirements.txt
├── docker-compose.yml
├── .env.example
├── src/
│   ├── server.ts/main.py           # Entry point
│   ├── websocket/
│   │   ├── handler.ts              # WS connection handler
│   │   └── session.ts              # Session management
│   ├── stt/
│   │   ├── deepgram.ts
│   │   ├── openai.ts
│   │   └── whisper.ts
│   ├── api/
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   └── sessions.ts
│   │   └── middleware/
│   │       ├── auth.ts
│   │       └── ratelimit.ts
│   ├── db/
│   │   ├── schema.prisma
│   │   └── client.ts
│   └── utils/
│       ├── logger.ts
│       └── config.ts
└── tests/
    ├── integration/
    └── unit/
```

---

## 7. MVP Success Criteria

✅ **Core Functionality:**
- [ ] Extension успешно захватывает аудио из Google Meet
- [ ] Аудио передается на backend через WebSocket
- [ ] Backend возвращает real-time транскрипцию (partial + final)
- [ ] Транскрипция отображается в overlay на странице

✅ **User Experience:**
- [ ] Пользователь может запустить/остановить запись одной кнопкой
- [ ] UI показывает статус соединения
- [ ] Транскрипция обновляется с задержкой < 1 секунды
- [ ] Можно экспортировать результат в текстовый файл

✅ **Stability:**
- [ ] Соединение восстанавливается при разрыве
- [ ] Ошибки отображаются пользователю
- [ ] Нет критичных багов за 30-минутный звонок

---

## 8. Риски и митигация

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| chrome.tabCapture недоступен на некоторых сайтах | Высокая | Высокое | Fallback на getDisplayMedia |
| Высокая latency STT | Средняя | Среднее | Использовать Deepgram (fast) |
| Проблемы с permissions в MV3 | Средняя | Высокое | Тщательное тестирование, fallbacks |
| Блокировка в Chrome Web Store | Низкая | Критичное | Следовать всем policy, добавить privacy policy |
| Высокие затраты на STT API | Средняя | Среднее | Лимиты для free tier, оптимизация |

---

## 9. Следующие шаги

1. **Выбор STT провайдера** - протестировать Deepgram vs OpenAI на реальных звонках
2. **Создать прототип audio capture** - проверить работу tabCapture на всех платформах
3. **Scaffold проектов** - настроить dev окружение (frontend + backend)
4. **Первый E2E тест** - записать простой звонок и получить транскрипт

---

## 10. Полезные ссылки

- [Chrome Extensions MV3 Docs](https://developer.chrome.com/docs/extensions/mv3/)
- [chrome.tabCapture API](https://developer.chrome.com/docs/extensions/reference/tabCapture/)
- [AudioWorklet Guide](https://developer.chrome.com/blog/audio-worklet/)
- [Deepgram Streaming API](https://developers.deepgram.com/docs/streaming)
- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime)
