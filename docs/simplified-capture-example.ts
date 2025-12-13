// УПРОЩЕННЫЙ ВАРИАНТ: chrome.tabCapture.capture() напрямую в offscreen document
// Используйте этот вариант, если разрешение пользователя не проблема

// ============================================
// SERVICE WORKER (service-worker.ts)
// ============================================

if (message.type === 'START_RECORDING') {
  // Check if already recording
  if (currentStatus === 'recording') {
    sendResponse({ error: 'Recording already in progress' });
    return true;
  }

  // Get active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) {
      sendResponse({ error: 'No active tab found' });
      return;
    }

    const tabId = tabs[0].id;

    // Просто передаем tabId в offscreen document
    // Offscreen document сам вызовет capture()
    sendToOffscreen({ type: 'OFFSCREEN_START_SESSION', language: 'ru-RU' })
      .then(() => {
        setTimeout(() => {
          sendToOffscreen({ type: 'OFFSCREEN_START_CAPTURE', tabId })
            .then((response) => {
              if (!response.error) {
                currentStatus = 'recording';
                notifyPopup({ type: 'STATUS_UPDATE', status: currentStatus });
              }
              sendResponse(response);
            })
            .catch((err) => sendResponse({ error: err.message }));
        }, 100);
      })
      .catch((err) => sendResponse({ error: err.message }));
  });
  return true;
}

// ============================================
// OFFSCREEN DOCUMENT (offscreen.ts)
// ============================================

// Упрощенная функция startCapture
async function startCapture(tabId?: number) {
  try {
    // Stop any existing capture first
    if (workletNode || mediaStream || audioContext) {
      console.log('Stopping existing capture before starting new one');
      stopCapture();
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    let stream: MediaStream;

    if (tabId !== undefined) {
      // ВАРИАНТ 1: Используем chrome.tabCapture.capture() напрямую
      // Это проще и работает в offscreen document!
      stream = await new Promise<MediaStream>((resolve, reject) => {
        chrome.tabCapture.capture(
          { audio: true, video: false },
          (capturedStream) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!capturedStream) {
              reject(new Error('Failed to capture tab audio'));
              return;
            }
            resolve(capturedStream);
          }
        );
      });
    } else {
      throw new Error('No tab ID provided');
    }

    await processStream(stream);
  } catch (err) {
    console.error('Failed to start capture:', err);
    notifyServiceWorker({ type: 'CAPTURE_STATUS', status: 'error', error: (err as Error).message });
    throw err;
  }
}

// Обработчик сообщений
case 'OFFSCREEN_START_CAPTURE':
  startCapture(message.tabId)
    .then(() => sendResponse({ success: true }))
    .catch((err) => sendResponse({ error: err.message }));
  return true;

// ============================================
// ПРЕИМУЩЕСТВА ЭТОГО ПОДХОДА:
// ============================================
// ✅ Проще код - один вызов вместо двух
// ✅ Меньше шагов - не нужен getMediaStreamId
// ✅ Прямой доступ к MediaStream
// ✅ Работает независимо от popup (offscreen document)
// ✅ Поддерживает WebSocket и AudioWorklet
//
// ⚠️ ТРЕБОВАНИЯ:
// - Разрешение tabCapture в manifest (у вас уже есть)
// - Offscreen document (у вас уже есть)
//
// ⚠️ ВАЖНО:
// chrome.tabCapture.capture() в offscreen document работает,
// но может потребоваться, чтобы вызов был в контексте
// пользовательского действия. Однако, передача tabId через
// сообщение обычно решает эту проблему.

