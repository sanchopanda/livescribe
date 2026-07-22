# Архитектура расширения LiveScribe

Простое и понятное объяснение того, как работает Chrome расширение LiveScribe для транскрибации видеозвонков.

## Содержание
- [Общая схема](#общая-схема)
- [Компоненты расширения](#компоненты-расширения)
- [Как это работает](#как-это-работает)
- [Поток данных](#поток-данных)
- [Технические детали](#технические-детали)

---

## Общая схема

LiveScribe - это Chrome расширение, которое:
1. **Захватывает аудио** из вкладки браузера (видеозвонок, YouTube и т.д.)
2. **Отправляет аудио** на бэкенд-сервер для распознавания речи
3. **Получает транскрипции** обратно в реальном времени
4. **Показывает текст** в виджете прямо на странице

**Важно:** Пользователь **слышит звук** во время записи! Расширение только "подслушивает" аудио, не перехватывая его.

### Обновление: platform-first архитектура

Сейчас extension разделён на общий runtime и платформо-специфичные модули:

- `src/content/platforms/*` — логика конкретных платформ (Pachca, Teams и т.д.)
- `src/content/platform/platform-adapter.ts` — единая точка доступа для UI/runtime
- `src/platform/audio-mode-capabilities.ts` — capability-конфиг платформ

Режимы аудио:
- **mixed** — захват общего аудио вкладки (`chrome.tabCapture`)
- **per-track** — захват отдельных WebRTC аудиотреков участников (реализован для Pachca и Google Meet)

Показ переключателя режима в UI и runtime-решения теперь capability-driven.

---

## Компоненты расширения

Расширение состоит из 3 основных частей, каждая со своей ролью:

### 1. Content Script (`src/content/content.ts`)
**Что это:** JavaScript код, который запускается **на каждой открытой странице** браузера.

**Что делает:**
- 🎨 Рисует **виджет** (плавающее окошко) на странице
- 🖱️ Обрабатывает клики пользователя на кнопки Start/Stop
- 📝 **Показывает транскрипции** в виджете в реальном времени
- 💬 Общается с Service Worker через сообщения

**Простыми словами:** Это UI расширения - то, что видит пользователь.

---

### 2. Service Worker (`src/background/service-worker.ts`)
**Что это:** Фоновый скрипт, который работает **постоянно** (даже когда страницы закрыты).

**Что делает:**
- 🎛️ **Координирует** работу между Content Script и Offscreen Document
- 📨 **Пересылает сообщения** между компонентами
- 🔄 Управляет жизненным циклом Offscreen Document
- 📊 Хранит состояние записи (idle/recording)

**Простыми словами:** Это "мозг" расширения - координатор всех процессов.

---

### 3. Offscreen Document (`src/offscreen/offscreen.ts`)
**Что это:** Невидимая страница, которая работает **в фоне**.

**Что делает:**
- 🎤 **Захватывает аудио** через chrome.tabCapture API
- 🔊 **Воспроизводит аудио** через Audio element (чтобы пользователь слышал)
- 🎵 **Обрабатывает аудио** через AudioWorklet (конвертирует в PCM формат)
- 🌐 **Подключается к WebSocket** и отправляет аудио на бэкенд
- 📥 **Получает транскрипции** от бэкенда и пересылает в Service Worker

**Простыми словами:** Это "работник" - делает всю тяжёлую работу по обработке аудио.

---

## Как это работает

### Шаг 1: Пользователь нажимает Start

```
1. Пользователь кликает "Start" в виджете
2. Content Script отправляет сообщение "START_RECORDING" в Service Worker
3. Service Worker получает сообщение
```

### Шаг 2: Запуск записи

```
4. Service Worker создаёт Offscreen Document (если его нет)
5. Определяет platform/audioMode и capabilities
6. Если режим mixed:
   - вызывает chrome.tabCapture.getMediaStreamId()
   - отправляет streamId в Offscreen Document
7. Если режим per-track (и поддержан платформой):
   - не запускает tabCapture
   - ждёт поканальные чанки из content per-track pipeline
```

**Что происходит в браузере:**
- В вкладке появляется 🔵 синий квадрат с текстом "Tab's content is being shared"
- Это нормально! Это индикатор chrome.tabCapture

### Шаг 3: Обработка аудио (mixed/per-track)

```
7. В mixed режиме Offscreen получает streamId
8. Создаёт MediaStream из streamId
9. Создаёт два пути для аудио:

   ┌─────────────── MediaStream ───────────────┐
   │                                            │
   ↓                                            ↓
[Audio Element]                      [AudioWorklet]
   │                                            │
   ↓                                            ↓
   Воспроизведение                           Обработка
 (пользователь слышит)              (конвертация в PCM)

10. В per-track режиме (Pachca, Google Meet) используется отдельный пайплайн:
    - MAIN-world hook регистрирует remote WebRTC audio tracks
    - per-track transcriber захватывает каждый трек через AudioWorklet
    - чанки отправляются participant-aware (`participantId`, `speaker`)
```

**Подробнее:**

**Путь 1 - Воспроизведение:**
```javascript
const audioElement = new Audio();
audioElement.srcObject = mediaStream;
audioElement.play();
```
→ Пользователь слышит звук!

**Путь 2 - Обработка:**
```javascript
sourceNode = audioContext.createMediaStreamSource(mediaStream);
workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
sourceNode.connect(workletNode);
```
→ Аудио обрабатывается для транскрибации

### Шаг 4: Отправка на бэкенд

```
10. AudioWorklet конвертирует аудио в PCM формат (Int16, 16000 Hz)
11. Offscreen отправляет аудио чанки по WebSocket:
    {
      type: "audio",
      sessionId: "...",
      sampleRate: 16000,
      channels: 1,
      chunk: "<base64 encoded audio>"
    }
```

### Шаг 5: Получение транскрипций

```
12. Бэкенд распознаёт речь (через Deepgram)
13. Бэкенд отправляет обратно по WebSocket:

    Частичные результаты (каждую секунду):
    { type: "partial", text: "Hello wor..." }

    Финальные результаты:
    { type: "final", text: "Hello world!" }
```

### Шаг 6: Показ транскрипций

```
14. Offscreen получает сообщение от WebSocket
15. Offscreen отправляет "WS_MESSAGE" в Service Worker
16. Service Worker пересылает в Content Script:
    chrome.tabs.sendMessage(tabId, { type: "WS_MESSAGE", message: ... })
17. Content Script обновляет виджет:
    - Частичный текст → серый цвет (пока распознаётся)
    - Финальный текст → чёрный цвет (добавляется к истории)
```

---

## Поток данных

### Полная схема потока данных

```
┌─────────────────────────────────────────────────────────────┐
│                      Chrome Tab (YouTube)                    │
│                           🔊 Audio                           │
└────────────────────────────┬────────────────────────────────┘
                             │
                             │ chrome.tabCapture
                             │
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                    Offscreen Document                        │
│  ┌──────────────────┐          ┌──────────────────┐        │
│  │  Audio Element   │          │  AudioWorklet    │        │
│  │   (playback)     │          │   (processing)   │        │
│  └────────┬─────────┘          └────────┬─────────┘        │
│           │                              │                   │
│           ↓                              ↓                   │
│      🔊 Speakers              PCM chunks (base64)           │
│                                          │                   │
│                                          ↓                   │
│                               ┌──────────────────┐          │
│                               │   WebSocket      │          │
│                               │ ws://localhost   │          │
│                               └────────┬─────────┘          │
└────────────────────────────────────────┼───────────────────┘
                                         │
                    Audio chunks         │         Transcripts
                         ↓               │               ↑
┌────────────────────────────────────────┼───────────────────┐
│                    Backend Server      │                    │
│  ┌─────────────────────────────────────┼──────────────┐   │
│  │          WebSocket Handler          ↓              │   │
│  │  1. Receive audio chunks                           │   │
│  │  2. Send to STT provider (Deepgram)               │   │
│  │  3. Get transcripts                                │   │
│  │  4. Send back: { type: "partial", text: "..." }   │   │
│  └────────────────────────────────────┬───────────────┘   │
└────────────────────────────────────────┼───────────────────┘
                                         │
                                         ↓
┌─────────────────────────────────────────────────────────────┐
│                    Offscreen Document                        │
│                  Receives WS_MESSAGE                         │
│                          ↓                                   │
│                  Sends to Service Worker                     │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                    Service Worker                            │
│           Forwards transcripts to Content Script             │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                    Content Script                            │
│  ┌──────────────────────────────────────────────────┐      │
│  │              LiveScribe Widget                    │      │
│  │  ┌──────────────────────────────────────────┐   │      │
│  │  │ 📝 Transcript Display                     │   │      │
│  │  │                                            │   │      │
│  │  │ "Hello world!"                            │   │      │
│  │  │ "How are you?"                            │   │      │
│  │  │ "I'm good, thanks..." (partial)           │   │      │
│  │  └──────────────────────────────────────────┘   │      │
│  └──────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## Технические детали

### Почему нужен Offscreen Document?

**Проблема:** Content Script не может использовать chrome.tabCapture напрямую.

**Решение:** Offscreen Document - это специальный невидимый документ, который:
- Имеет доступ к Chrome APIs (включая tabCapture)
- Может работать с Web Audio API и WebSocket
- Работает в фоне, не мешая пользователю

### Почему используется Audio Element?

**Проблема:** Когда chrome.tabCapture захватывает аудио, оригинальное воспроизведение может пропасть.

**Решение:** Мы явно воспроизводим захваченный поток через `<audio>` элемент:
```javascript
const audioElement = new Audio();
audioElement.srcObject = capturedStream;
audioElement.play();
```

Это гарантирует, что пользователь слышит звук, даже когда мы обрабатываем его для транскрибации.

### Почему два соединения нужны?

**Не путать:**
- **AudioWorklet → обработка аудио** (для отправки на бэкенд)
- **Audio Element → воспроизведение** (чтобы пользователь слышал)

Оба используют один и тот же `MediaStream`, но для разных целей!

### Формат аудио

- **Входной формат:** Float32Array (от Chrome)
- **AudioWorklet конвертирует в:** Int16 PCM, 16000 Hz, Mono
- **Отправка:** Base64 encoded chunks по 8KB
- **На бэкенде:** Декодируется и отправляется в STT (Deepgram)

### Обработка ошибок

**"Receiving end does not exist":**
- Происходит, когда Offscreen Document закрывается
- Service Worker автоматически сбрасывает флаг `offscreenCreated`
- При следующем старте создаётся новый Offscreen Document

**WebSocket reconnection:**
- Offscreen автоматически переподключается при разрыве соединения
- Content Script показывает статус подключения

---

## Преимущества текущей архитектуры

✅ **Разделение ответственности:**
- Content Script = UI
- Service Worker = Координация
- Offscreen = Тяжёлая работа

✅ **Пользователь слышит звук:**
- Audio Element воспроизводит захваченный поток
- Нет "заглушения" аудио во время записи

✅ **Эффективность:**
- Только одно WebSocket соединение
- Минимальная задержка транскрипций
- Оптимизированная обработка аудио

✅ **Надёжность:**
- Автоматическое восстановление при ошибках
- Правильное управление жизненным циклом компонентов
- Обработка edge cases (закрытие вкладки, потеря соединения и т.д.)

---

## Разработка и отладка

### Как отладить каждый компонент:

**Content Script:**
```
1. Откройте DevTools на странице (F12)
2. Во вкладке Console увидите логи от content.ts
3. Можно ставить breakpoints в Sources
```

**Service Worker:**
```
1. Откройте chrome://extensions
2. Найдите LiveScribe
3. Нажмите "Inspect views: service worker"
4. Откроется отдельное DevTools окно для service worker
```

**Offscreen Document:**
```
1. Откройте chrome://extensions
2. Найдите LiveScribe
3. Нажмите "Inspect views: offscreen.html"
4. Откроется DevTools для offscreen документа
```

### Полезные логи

- Content Script: `console.log('Recording started via service worker + offscreen')`
- Service Worker: `console.log('Received message:', message.type)`
- Offscreen: `console.log('Audio capture started')`
- Offscreen: `console.log('Received from server:', message)` - транскрипции от бэкенда

---

## FAQ

**Q: Почему не используется прямое подключение Content Script к WebSocket?**

A: Content Script работает в контексте страницы и может быть перезагружен. Offscreen Document более стабилен и имеет полный доступ к Chrome APIs.

**Q: Почему транскрипции идут через Service Worker, а не напрямую?**

A: Service Worker - это единственный способ надёжно передать сообщения между Offscreen и Content Script. Он действует как "почтальон".

**Q: Можно ли использовать это расширение для других целей?**

A: Да! Архитектура универсальна для любой задачи, где нужно:
- Захватить аудио из вкладки
- Обработать его в реальном времени
- Показать результаты на странице

**Q: Почему используется AudioWorklet, а не MediaRecorder?**

A: AudioWorklet даёт больше контроля над форматом аудио. Мы можем конвертировать в точный формат, который ожидает бэкенд (PCM Int16, 16000 Hz).

---

## Дальнейшие улучшения

Возможные направления развития:

1. **Локальное кэширование транскрипций** (IndexedDB)
2. **Поддержка нескольких языков** одновременно
3. **Экспорт транскрипций** в разные форматы (TXT, SRT, JSON)
4. **Speaker diarization** (определение, кто говорит)
5. **Offline режим** с локальной моделью STT

---

Создано с помощью Claude Code 🤖
