// Content script for LiveScribe widget UI
// Audio capture is handled by service worker + offscreen document

console.log('LiveScribe content script loaded');

let isCapturing = false;
let contentSessionId: string | null = null;
let transcriptText = '';
let partialText = '';
let isMinimized = false;

// Language options (currently supported by Vosk STT)
const LANGUAGES = [
  { value: 'ru-RU', label: 'Russian' },
  { value: 'en-US', label: 'English' },
];

// Get selected language from localStorage with error handling
function getSelectedLanguage(): string {
  try {
    return localStorage.getItem('livescribe-language') || 'ru-RU';
  } catch (err) {
    console.warn('Failed to access localStorage, using default language:', err);
    return 'ru-RU';
  }
}

// Save selected language to localStorage with error handling
function saveSelectedLanguage(language: string): void {
  try {
    localStorage.setItem('livescribe-language', language);
  } catch (err) {
    console.warn('Failed to save language to localStorage:', err);
  }
}

// Get widget position from localStorage with error handling
function getWidgetPosition(): { x: number; y: number } {
  try {
    const saved = localStorage.getItem('livescribe-widget-position');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (err) {
    console.warn('Failed to access localStorage for position:', err);
  }
  return { x: 20, y: 20 };
}

// Save widget position to localStorage with error handling
function saveWidgetPosition(x: number, y: number): void {
  try {
    localStorage.setItem('livescribe-widget-position', JSON.stringify({ x, y }));
  } catch (err) {
    console.warn('Failed to save position to localStorage:', err);
  }
}

// Get widget size from localStorage with error handling
function getWidgetSize(): { width: number; height: number } {
  try {
    const saved = localStorage.getItem('livescribe-widget-size');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (err) {
    console.warn('Failed to access localStorage for size:', err);
  }
  return { width: 400, height: 300 };
}

// Save widget size to localStorage with error handling
function saveWidgetSize(width: number, height: number): void {
  try {
    localStorage.setItem('livescribe-widget-size', JSON.stringify({ width, height }));
  } catch (err) {
    console.warn('Failed to save size to localStorage:', err);
  }
}

// Get minimized state from localStorage with error handling
function getMinimizedState(): boolean {
  try {
    const saved = localStorage.getItem('livescribe-widget-minimized');
    return saved === 'true';
  } catch (err) {
    console.warn('Failed to access localStorage for minimized state:', err);
    return false;
  }
}

// Save minimized state to localStorage with error handling
function saveMinimizedState(minimized: boolean): void {
  try {
    localStorage.setItem('livescribe-widget-minimized', minimized ? 'true' : 'false');
  } catch (err) {
    console.warn('Failed to save minimized state to localStorage:', err);
  }
}

// Create UI widget
function createUIWidget() {
  // Check if widget already exists
  if (document.getElementById('livescribe-widget')) {
    return;
  }

  const position = getWidgetPosition();
  const size = getWidgetSize();
  // Always create widget expanded, regardless of saved state
  isMinimized = false;

  const widget = document.createElement('div');
  widget.id = 'livescribe-widget';
  widget.style.cssText = `
    position: fixed;
    left: ${position.x}px;
    top: ${position.y}px;
    width: ${size.width}px;
    height: ${size.height}px;
    min-width: 200px;
    min-height: 150px;
    max-width: 800px;
    max-height: 600px;
    z-index: 999999;
    background: white;
    border: 2px solid #3b82f6;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex;
    flex-direction: column;
    resize: none;
    overflow: hidden;
  `;

  const selectedLanguage = getSelectedLanguage();
  const languageOptions = LANGUAGES.map(
    (lang) => `<option value="${lang.value}" ${lang.value === selectedLanguage ? 'selected' : ''}>${lang.label}</option>`
  ).join('');

  widget.innerHTML = `
    <div id="livescribe-header" style="
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: #f3f4f6;
      border-bottom: 1px solid #e5e7eb;
      cursor: move;
      user-select: none;
      flex-shrink: 0;
    ">
      <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
        <div id="livescribe-status" style="width: 12px; height: 12px; border-radius: 50%; background: #9ca3af; flex-shrink: 0;"></div>
        <span id="livescribe-status-text" style="font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Ready</span>
      </div>
      <div style="display: flex; gap: 4px; flex-shrink: 0;">
        <button id="livescribe-minimize" style="
          width: 24px;
          height: 24px;
          padding: 0;
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          color: #6b7280;
          display: flex;
          align-items: center;
          justify-content: center;
        " title="Minimize">▼</button>
        <button id="livescribe-close" style="
          width: 24px;
          height: 24px;
          padding: 0;
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
          color: #6b7280;
          display: flex;
          align-items: center;
          justify-content: center;
        " title="Close">×</button>
      </div>
    </div>
    <div id="livescribe-content" style="
      flex: 1;
      padding: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    ">
      <select id="livescribe-language" style="
        width: 100%;
        padding: 6px 8px;
        margin-bottom: 8px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 12px;
        background: white;
        cursor: pointer;
      ">
        ${languageOptions}
      </select>
      <div style="display: flex; gap: 8px; margin-bottom: 8px;">
        <button id="livescribe-start" style="
          flex: 1;
          padding: 6px 12px;
          background: #10b981;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
        ">Start</button>
        <button id="livescribe-stop" style="
          flex: 1;
          padding: 6px 12px;
          background: #ef4444;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          display: none;
        ">Stop</button>
      </div>
      <div id="livescribe-transcript" style="
        flex: 1;
        padding: 8px;
        background: #f3f4f6;
        border-radius: 4px;
        font-size: 12px;
        overflow-y: auto;
        overflow-x: hidden;
        min-height: 40px;
        display: none;
      ">
        <div id="livescribe-transcript-text" style="color: #374151; line-height: 1.5; word-wrap: break-word;"></div>
      </div>
      <div id="livescribe-error" style="
        margin-top: 8px;
        padding: 6px;
        background: #fee2e2;
        color: #991b1b;
        border-radius: 4px;
        font-size: 11px;
        display: none;
      "></div>
    </div>
    <div id="livescribe-resize-handle" style="
      position: absolute;
      bottom: 0;
      right: 0;
      width: 20px;
      height: 20px;
      cursor: nwse-resize;
      background: linear-gradient(-45deg, transparent 0%, transparent 30%, #9ca3af 30%, #9ca3af 35%, transparent 35%, transparent 65%, #9ca3af 65%, #9ca3af 70%, transparent 70%);
      z-index: 1;
    "></div>
  `;

  document.body.appendChild(widget);

  // Setup drag and drop
  setupDragAndDrop(widget);
  
  // Setup resize
  setupResize(widget);

  // Add event listeners
  document.getElementById('livescribe-start')?.addEventListener('click', handleStart);
  document.getElementById('livescribe-stop')?.addEventListener('click', handleStop);
  document.getElementById('livescribe-minimize')?.addEventListener('click', toggleMinimize);
  document.getElementById('livescribe-close')?.addEventListener('click', closeWidget);
  document.getElementById('livescribe-language')?.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement;
    saveSelectedLanguage(target.value);
  });
}

// Setup drag and drop
function setupDragAndDrop(widget: HTMLElement): void {
  const header = document.getElementById('livescribe-header');
  if (!header) return;

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  header.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = widget.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    const newLeft = Math.max(0, Math.min(window.innerWidth - widget.offsetWidth, startLeft + deltaX));
    const newTop = Math.max(0, Math.min(window.innerHeight - widget.offsetHeight, startTop + deltaY));
    widget.style.left = `${newLeft}px`;
    widget.style.top = `${newTop}px`;
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      const rect = widget.getBoundingClientRect();
      saveWidgetPosition(rect.left, rect.top);
      isDragging = false;
    }
  });
}

// Setup resize
function setupResize(widget: HTMLElement): void {
  const resizeHandle = document.getElementById('livescribe-resize-handle');
  if (!resizeHandle) return;

  let isResizing = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startWidth = widget.offsetWidth;
    startHeight = widget.offsetHeight;
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    const newWidth = Math.max(200, Math.min(800, startWidth + deltaX));
    const newHeight = Math.max(150, Math.min(600, startHeight + deltaY));
    widget.style.width = `${newWidth}px`;
    widget.style.height = `${newHeight}px`;
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      saveWidgetSize(widget.offsetWidth, widget.offsetHeight);
      isResizing = false;
    }
  });
}

// Toggle minimize
function toggleMinimize(): void {
  const widget = document.getElementById('livescribe-widget');
  const content = document.getElementById('livescribe-content');
  const resizeHandle = document.getElementById('livescribe-resize-handle');
  const minimizeBtn = document.getElementById('livescribe-minimize');
  
  if (!widget || !content || !resizeHandle || !minimizeBtn) return;

  isMinimized = !isMinimized;
  saveMinimizedState(isMinimized);

  if (isMinimized) {
    widget.style.width = '120px';
    widget.style.height = '40px';
    content.style.display = 'none';
    resizeHandle.style.display = 'none';
    minimizeBtn.textContent = '▲';
  } else {
    const size = getWidgetSize();
    widget.style.width = `${size.width}px`;
    widget.style.height = `${size.height}px`;
    content.style.display = 'flex';
    resizeHandle.style.display = 'block';
    minimizeBtn.textContent = '▼';
  }
}

// Close widget
function closeWidget(): void {
  const widget = document.getElementById('livescribe-widget');
  if (widget) {
    widget.remove();
    if (isCapturing) {
      handleStop();
    }
  }
}

// Update transcript display
function updateTranscript() {
  const transcriptDiv = document.getElementById('livescribe-transcript');
  const transcriptTextDiv = document.getElementById('livescribe-transcript-text');
  
  if (!transcriptDiv || !transcriptTextDiv) return;

  const fullText = transcriptText + (partialText ? ` <span style="color: #6b7280; font-style: italic;">${partialText}</span>` : '');
  
  if (fullText.trim()) {
    transcriptTextDiv.innerHTML = fullText;
    transcriptDiv.style.display = 'block';
  } else {
    transcriptDiv.style.display = 'none';
  }
}

// Update UI status
function updateStatus(status: 'idle' | 'recording' | 'error' | 'waiting', error?: string) {
  const statusDot = document.getElementById('livescribe-status');
  const statusText = document.getElementById('livescribe-status-text');
  const startBtn = document.getElementById('livescribe-start');
  const stopBtn = document.getElementById('livescribe-stop');
  const errorDiv = document.getElementById('livescribe-error');
  const languageSelect = document.getElementById('livescribe-language') as HTMLSelectElement | null;

  if (!statusDot || !statusText || !startBtn || !stopBtn || !errorDiv) return;

  switch (status) {
    case 'recording':
      statusDot.style.background = '#ef4444';
      statusText.textContent = 'Recording';
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
      errorDiv.style.display = 'none';
      if (languageSelect) {
        languageSelect.disabled = true;
        languageSelect.style.opacity = '0.5';
        languageSelect.style.cursor = 'not-allowed';
      }
      break;
    case 'waiting':
      statusDot.style.background = '#f59e0b';
      statusText.textContent = 'Waiting for audio...';
      startBtn.style.display = 'none';
      stopBtn.style.display = 'none';
      errorDiv.style.display = 'none';
      if (languageSelect) {
        languageSelect.disabled = true;
        languageSelect.style.opacity = '0.5';
        languageSelect.style.cursor = 'not-allowed';
      }
      break;
    case 'error':
      statusDot.style.background = '#ef4444';
      statusText.textContent = 'Error';
      startBtn.style.display = 'block';
      stopBtn.style.display = 'none';
      if (languageSelect) {
        languageSelect.disabled = false;
        languageSelect.style.opacity = '1';
        languageSelect.style.cursor = 'pointer';
      }
      if (error) {
        errorDiv.textContent = error;
        errorDiv.style.display = 'block';
      }
      break;
    default:
      statusDot.style.background = '#9ca3af';
      statusText.textContent = 'Ready';
      startBtn.style.display = 'block';
      stopBtn.style.display = 'none';
      errorDiv.style.display = 'none';
      if (languageSelect) {
        languageSelect.disabled = false;
        languageSelect.style.opacity = '1';
        languageSelect.style.cursor = 'pointer';
      }
  }
}

// Start capture - delegate to service worker + offscreen document
async function handleStart() {
  if (isCapturing) {
    return;
  }

  try {
    updateStatus('idle');

    // Get selected language
    const language = getSelectedLanguage();

    // Ask service worker to start recording using tabCapture + offscreen
    // Offscreen will handle WebSocket and forward transcripts to us
    chrome.runtime.sendMessage(
      { type: 'START_RECORDING', language },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('Failed to start recording:', chrome.runtime.lastError);
          updateStatus('error', chrome.runtime.lastError.message);
          return;
        }

        if (response && response.error) {
          console.error('Failed to start recording:', response.error);
          updateStatus('error', response.error);
          return;
        }

        // Success - service worker + offscreen will handle audio capture and transcripts
        isCapturing = true;
        updateStatus('recording');
        console.log('Recording started via service worker + offscreen');
      }
    );
  } catch (err) {
    console.error('Failed to start capture:', err);
    updateStatus('error', (err as Error).message);
  }
}

// Stop capture
async function handleStop() {
  isCapturing = false;

  // Ask service worker to stop recording
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, () => {
    if (chrome.runtime.lastError) {
      console.error('Failed to stop recording:', chrome.runtime.lastError);
    }
    console.log('Recording stopped via service worker');
  });

  // Clear transcript when stopping
  transcriptText = '';
  partialText = '';
  updateTranscript();

  updateStatus('idle');
}


// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CONTENT_START') {
    handleStart().then(() => sendResponse({ success: true })).catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'CONTENT_STOP') {
    handleStop();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'CONTENT_GET_STATUS') {
    sendResponse({
      status: isCapturing ? 'recording' : 'idle',
      sessionId: contentSessionId,
    });
    return true;
  }

  if (message.type === 'CONTENT_TOGGLE_WIDGET') {
    const widget = document.getElementById('livescribe-widget');
    if (widget) {
      widget.remove();
      console.log('Widget hidden');
      sendResponse({ success: true, action: 'hidden' });
    } else {
      console.log('Creating widget...');
      createUIWidget();
      console.log('Widget created');
      sendResponse({ success: true, action: 'shown' });
    }
    return true;
  }

  // Handle WebSocket messages forwarded from service worker
  if (message.type === 'WS_MESSAGE') {
    const wsMessage = message.message;
    console.log('Received transcript:', wsMessage);

    if (wsMessage.type === 'partial') {
      partialText = wsMessage.text || '';
      updateTranscript();
    } else if (wsMessage.type === 'final') {
      if (wsMessage.text) {
        transcriptText += (transcriptText ? ' ' : '') + wsMessage.text;
      }
      partialText = '';
      updateTranscript();
    } else if (wsMessage.type === 'status' && wsMessage.sessionId) {
      contentSessionId = wsMessage.sessionId;
    }
    return false;
  }

  return false;
});

