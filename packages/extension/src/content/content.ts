// Content script for capturing audio directly from page
// This runs in the page context and can intercept audio without tabCapture indicator

console.log('LiveScribe content script loaded');

let audioContext: AudioContext | null = null;
let workletNode: AudioWorkletNode | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let mediaStream: MediaStream | null = null;
let isCapturing = false;
let contentSessionId: string | null = null;
let ws: WebSocket | null = null;

const WS_URL = 'ws://localhost:3001/ws';

// Create UI widget
function createUIWidget() {
  // Check if widget already exists
  if (document.getElementById('livescribe-widget')) {
    return;
  }

  const widget = document.createElement('div');
  widget.id = 'livescribe-widget';
  widget.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 999999;
    background: white;
    border: 2px solid #3b82f6;
    border-radius: 8px;
    padding: 12px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    min-width: 200px;
  `;

  widget.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
      <div id="livescribe-status" style="width: 12px; height: 12px; border-radius: 50%; background: #9ca3af;"></div>
      <span id="livescribe-status-text" style="font-size: 14px; font-weight: 500;">Ready</span>
    </div>
    <div style="display: flex; gap: 8px;">
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
    <div id="livescribe-error" style="
      margin-top: 8px;
      padding: 6px;
      background: #fee2e2;
      color: #991b1b;
      border-radius: 4px;
      font-size: 11px;
      display: none;
    "></div>
  `;

  document.body.appendChild(widget);

  // Add event listeners
  document.getElementById('livescribe-start')?.addEventListener('click', handleStart);
  document.getElementById('livescribe-stop')?.addEventListener('click', handleStop);
}

// Update UI status
function updateStatus(status: 'idle' | 'recording' | 'error', error?: string) {
  const statusDot = document.getElementById('livescribe-status');
  const statusText = document.getElementById('livescribe-status-text');
  const startBtn = document.getElementById('livescribe-start');
  const stopBtn = document.getElementById('livescribe-stop');
  const errorDiv = document.getElementById('livescribe-error');

  if (!statusDot || !statusText || !startBtn || !stopBtn || !errorDiv) return;

  switch (status) {
    case 'recording':
      statusDot.style.background = '#ef4444';
      statusText.textContent = 'Recording';
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
      errorDiv.style.display = 'none';
      break;
    case 'error':
      statusDot.style.background = '#ef4444';
      statusText.textContent = 'Error';
      startBtn.style.display = 'block';
      stopBtn.style.display = 'none';
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
  }
}

// Capture audio from page using Web Audio API
async function captureAudioFromPage(): Promise<MediaStream> {
  // Method 1: Try to get audio from video/audio elements via srcObject
  const videoElements = document.querySelectorAll('video');
  const audioElements = document.querySelectorAll('audio');

  for (const video of videoElements) {
    if (video.srcObject && video.srcObject instanceof MediaStream) {
      const stream = video.srcObject as MediaStream;
      if (stream.getAudioTracks().length > 0) {
        console.log('Found audio track in video element via srcObject');
        return stream;
      }
    }
  }

  for (const audio of audioElements) {
    if (audio.srcObject && audio.srcObject instanceof MediaStream) {
      const stream = audio.srcObject as MediaStream;
      if (stream.getAudioTracks().length > 0) {
        console.log('Found audio track in audio element via srcObject');
        return stream;
      }
    }
  }

  // Method 2: Use Web Audio API to capture from video/audio elements
  // This creates a MediaStreamDestination and connects it to the element's audio
  try {
    const tempContext = new AudioContext({ sampleRate: 16000 });
    const destination = tempContext.createMediaStreamDestination();

    let foundAudio = false;

    // Try video elements
    for (const video of videoElements) {
      if (video.srcObject || video.src) {
        try {
          const source = tempContext.createMediaElementSource(video);
          source.connect(destination);
          foundAudio = true;
          console.log('Connected to video element via Web Audio API');
          break;
        } catch (err) {
          // Element might already be connected to another AudioContext
          console.warn('Failed to connect to video element:', err);
        }
      }
    }

    // Try audio elements if no video found
    if (!foundAudio) {
      for (const audio of audioElements) {
        if (audio.srcObject || audio.src) {
          try {
            const source = tempContext.createMediaElementSource(audio);
            source.connect(destination);
            foundAudio = true;
            console.log('Connected to audio element via Web Audio API');
            break;
          } catch (err) {
            console.warn('Failed to connect to audio element:', err);
          }
        }
      }
    }

    if (foundAudio) {
      // Check if stream has audio tracks
      if (destination.stream.getAudioTracks().length > 0) {
        // Store context to keep it alive
        audioContext = tempContext;
        return destination.stream;
      } else {
        console.warn('Connected to element but no audio tracks in stream');
        tempContext.close();
      }
    } else {
      tempContext.close();
    }
  } catch (err) {
    console.warn('Web Audio API capture failed:', err);
  }

  // Method 3: No audio found - provide helpful error message
  const hasVideoElements = videoElements.length > 0;
  const hasAudioElements = audioElements.length > 0;

  if (!hasVideoElements && !hasAudioElements) {
    throw new Error(
      'No audio/video elements found on this page. Please open a page with video or audio content (e.g., YouTube, Google Meet, Zoom).'
    );
  }

  // Elements exist but no audio tracks found
  throw new Error(
    'Audio/video elements found, but no active audio tracks detected. ' +
      'Please ensure: 1) The video/audio is playing, 2) The tab is not muted, 3) The content has audio. ' +
      'Alternatively, use the extension popup to start recording (will show indicator).'
  );
}

// Connect to WebSocket
async function connectWebSocket(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }

    const newWs = new WebSocket(WS_URL);
    let resolved = false;

    newWs.onopen = () => {
      console.log('WebSocket connected from content script');
      ws = newWs;
      resolved = true;
      resolve();
    };

    newWs.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('Received from server:', message);

        if (message.type === 'status' && message.sessionId) {
          contentSessionId = message.sessionId;
          chrome.runtime.sendMessage({
            type: 'CONTENT_STATUS_UPDATE',
            status: message.status,
            sessionId: contentSessionId,
          });
        }
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };

    newWs.onerror = (error) => {
      console.error('WebSocket error:', error);
      if (!resolved) {
        reject(error);
      }
    };

    newWs.onclose = () => {
      console.log('WebSocket closed');
      if (ws === newWs) {
        ws = null;
        contentSessionId = null;
        if (isCapturing) {
          stopCapture();
        }
        chrome.runtime.sendMessage({ type: 'CONTENT_STATUS_UPDATE', status: 'idle' });
      }
    };
  });
}

// Start capture
async function handleStart() {
  if (isCapturing) {
    return;
  }

  try {
    updateStatus('idle');

    // Connect WebSocket first
    await connectWebSocket();

    // Start session
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'start', language: 'ru-RU' }));
      // Wait a bit for session ID
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Capture audio from page
    let stream: MediaStream;
    try {
      stream = await captureAudioFromPage();
    } catch (err) {
      // Capture failed - show error to user
      const errorMsg = (err as Error).message;
      console.error('Audio capture failed:', errorMsg);
      updateStatus('error', errorMsg);
      chrome.runtime.sendMessage({
        type: 'CONTENT_STATUS_UPDATE',
        status: 'error',
        error: errorMsg,
      });
      return;
    }

    // Process stream
    await processStream(stream);

    updateStatus('recording');
    chrome.runtime.sendMessage({ type: 'CONTENT_STATUS_UPDATE', status: 'recording' });
  } catch (err) {
    console.error('Failed to start capture:', err);
    updateStatus('error', (err as Error).message);
    chrome.runtime.sendMessage({
      type: 'CONTENT_STATUS_UPDATE',
      status: 'error',
      error: (err as Error).message,
    });
  }
}

// Stop capture
async function handleStop() {
  stopCapture();

  if (contentSessionId && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop', sessionId: contentSessionId }));
      contentSessionId = null;
  }

  updateStatus('idle');
  chrome.runtime.sendMessage({ type: 'CONTENT_STATUS_UPDATE', status: 'idle' });
}

// Process audio stream
async function processStream(stream: MediaStream) {
  if (stream.getAudioTracks().length === 0) {
    throw new Error('No audio tracks found in stream');
  }

  mediaStream = stream;

  // Create audio context if not already created (might be created in captureAudioFromPage)
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext({ sampleRate: 16000 });
  }

  // Load worklet
  await audioContext.audioWorklet.addModule(chrome.runtime.getURL('processor.worklet.js'));

  // Create nodes
  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  workletNode = new AudioWorkletNode(audioContext, 'audio-processor');

  // Handle audio chunks
  workletNode.port.onmessage = (event) => {
    if (event.data.type === 'audio-chunk' && contentSessionId && ws && ws.readyState === WebSocket.OPEN) {
      const chunk = event.data.chunk as ArrayBuffer;
      const base64 = arrayBufferToBase64(chunk);

      ws.send(
        JSON.stringify({
          type: 'audio',
          sessionId: contentSessionId,
          sampleRate: 16000,
          channels: 1,
          chunk: base64,
        })
      );
    }
  };

  // Connect nodes
  sourceNode.connect(workletNode);
  workletNode.connect(audioContext.destination);

  isCapturing = true;
  console.log('Audio capture started from content script');
}

// Stop capture
function stopCapture() {
  if (workletNode) {
    workletNode.port.onmessage = null;
    workletNode.disconnect();
    workletNode = null;
  }

  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => {
      track.stop();
      track.enabled = false;
    });
    mediaStream = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  isCapturing = false;
  console.log('Audio capture stopped');
}

// Helper: ArrayBuffer to base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
      wsConnected: ws !== null && ws.readyState === WebSocket.OPEN,
    });
    return true;
  }

  return false;
});

// Initialize UI when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createUIWidget);
} else {
  createUIWidget();
}

