# Способы захвата аудио с вкладки в Chrome расширениях

## Текущая реализация (Manifest V3)

### Как это работает сейчас:

1. **Service Worker** (`service-worker.ts`):
   - Получает ID активной вкладки через `chrome.tabs.query()`
   - Вызывает `chrome.tabCapture.getMediaStreamId({ targetTabId })` для получения streamId
   - Передает streamId в offscreen document через сообщение

2. **Offscreen Document** (`offscreen.ts`):
   - Получает streamId от service worker
   - Использует `navigator.mediaDevices.getUserMedia()` с специальными constraints:
     ```javascript
     {
       audio: {
         mandatory: {
           chromeMediaSource: 'tab',
           chromeMediaSourceId: streamId
         }
       }
     }
     ```
   - Создает MediaStream из этого источника
   - Обрабатывает аудио через AudioWorklet

### Преимущества текущего подхода:
- ✅ Работает в Manifest V3
- ✅ Не требует разрешения пользователя (автоматически при наличии `tabCapture` permission)
- ✅ Захватывает только аудио с конкретной вкладки
- ✅ Offscreen document позволяет работать с WebSocket и AudioWorklet

### Недостатки:
- ⚠️ Требует offscreen document (дополнительный контекст)
- ⚠️ Двухэтапный процесс (getMediaStreamId → getUserMedia)

---

## Альтернативные способы

### 1. `chrome.tabCapture.capture()` (Manifest V2 / не работает в MV3 SW)

**Как работает:**
```javascript
chrome.tabCapture.capture({ audio: true, video: false }, (stream) => {
  // stream - это MediaStream напрямую
});
```

**Проблемы в Manifest V3:**
- ❌ Не работает в Service Worker (только в background page)
- ❌ MediaStream нельзя передать через `chrome.runtime.sendMessage()` (не сериализуется)
- ❌ Требует вызов в контексте пользовательского действия

**Где может работать:**
- Content Script (но требует разрешения пользователя)
- Popup (но закрывается при потере фокуса)

---

### 2. Content Script + getUserMedia

**Как работает:**
```javascript
// В content script
navigator.mediaDevices.getUserMedia({ 
  audio: {
    mandatory: {
      chromeMediaSource: 'tab',
      chromeMediaSourceId: streamId
    }
  }
});
```

**Преимущества:**
- ✅ Может работать напрямую во вкладке
- ✅ Прямой доступ к DOM страницы

**Недостатки:**
- ❌ Требует разрешения пользователя (если нет tabCapture permission)
- ❌ Content script выполняется в контексте страницы (может конфликтовать)
- ❌ Ограничения безопасности (CSP страницы)

---

### 3. `chrome.desktopCapture` API

**Как работает:**
```javascript
chrome.desktopCapture.chooseDesktopMedia(
  ['audio', 'tab'],
  (streamId) => {
    navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId
        }
      }
    });
  }
);
```

**Преимущества:**
- ✅ Может захватывать весь экран/окно/вкладку
- ✅ Пользователь выбирает источник через системный диалог

**Недостатки:**
- ❌ Требует явного выбора пользователя каждый раз
- ❌ Может захватывать больше, чем нужно (весь экран)
- ❌ Менее удобен для автоматизации

---

### 4. `chrome.system.capture` (устаревший)

**Статус:** ⚠️ Устарел, не рекомендуется к использованию

---

## Сравнительная таблица

| Метод | Manifest V3 | Автоматический | Offscreen Doc | Разрешение пользователя |
|-------|-------------|----------------|---------------|------------------------|
| **getMediaStreamId + getUserMedia** (текущий) | ✅ | ✅ | ✅ | ❌ |
| tabCapture.capture() | ❌ | ✅ | ❌ | ❌ |
| Content Script + getUserMedia | ✅ | ⚠️ | ❌ | ⚠️ |
| desktopCapture | ✅ | ❌ | ❌ | ✅ |

---

## Упрощенный вариант (если разрешение пользователя не проблема)

### Использование `chrome.tabCapture.capture()` напрямую в offscreen document

Если разрешение пользователя не проблема, можно упростить код, используя `chrome.tabCapture.capture()` напрямую в offscreen document:

**Преимущества:**
- ✅ Один шаг вместо двух (не нужен getMediaStreamId)
- ✅ Меньше кода
- ✅ Прямой доступ к MediaStream

**Как работает:**
```typescript
// Service Worker - просто передаем tabId
sendToOffscreen({ type: 'START_CAPTURE', tabId });

// Offscreen Document - вызываем capture() напрямую
chrome.tabCapture.capture(
  { audio: true, video: false },
  (stream) => {
    if (stream) {
      processStream(stream);
    }
  }
);
```

**Важно:** `chrome.tabCapture.capture()` работает в offscreen document, но требует:
- Разрешение `tabCapture` в manifest
- Вызов должен происходить в контексте пользовательского действия (но это можно обойти, передавая tabId)

---

## Рекомендации

### Для Manifest V3 расширений:

#### Если разрешение пользователя НЕ проблема:
1. **`chrome.tabCapture.capture()` в offscreen document** ⭐ **РЕКОМЕНДУЕТСЯ**
   - Проще код
   - Один шаг вместо двух
   - Работает независимо от popup

#### Если нужен автоматический захват без разрешения:
1. **Текущий подход (getMediaStreamId)** - единственный вариант
2. **desktopCapture** - если нужен выбор пользователя или захват всего экрана

### Почему capture() в offscreen лучше (если разрешение не проблема):
- ✅ Проще код (один вызов вместо двух)
- ✅ Прямой доступ к MediaStream
- ✅ Offscreen document работает независимо от popup
- ✅ Поддерживает WebSocket и AudioWorklet

---

## Примеры кода

### Текущая реализация (упрощенно):

```typescript
// Service Worker
chrome.tabCapture.getMediaStreamId(
  { targetTabId: tabId },
  (streamId) => {
    // Передать streamId в offscreen
    sendToOffscreen({ type: 'START_CAPTURE', streamId });
  }
);

// Offscreen Document
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    mandatory: {
      chromeMediaSource: 'tab',
      chromeMediaSourceId: streamId
    }
  }
});
```

### Альтернатива через desktopCapture:

```typescript
// Service Worker или Popup
chrome.desktopCapture.chooseDesktopMedia(
  ['audio', 'tab'],
  async (streamId) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId
        }
      }
    });
  }
);
```

---

## Ограничения и особенности

1. **StreamId имеет ограниченное время жизни** - нужно получать новый при каждом запуске
2. **getUserMedia с chromeMediaSource работает только в определенных контекстах:**
   - Offscreen Document ✅
   - Content Script ✅ (с ограничениями)
   - Service Worker ❌
   - Popup ⚠️ (может работать, но popup может закрыться)

3. **AudioWorklet требует отдельный файл** - нельзя использовать inline worklet

