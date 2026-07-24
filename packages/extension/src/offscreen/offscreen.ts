// Offscreen document for WebSocket and Audio Capture
// This runs persistently and maintains connections

import type { ClientMessage, ServerMessage } from '@livescribe/shared';

console.log('Skribo offscreen document initialized');

// Injected at build time via Vite `define` (see vite.config.ts).
declare const __WS_URL__: string;
const WS_URL = __WS_URL__;

// State
let ws: WebSocket | null = null;
let sessionId: string | null = null;
let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let workletNode: AudioWorkletNode | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let wsCloseInitiator: string = 'remote-or-unknown';
let pendingAudioDurationMs = 0;
let audioProgressFlushTimer: number | null = null;
let lastMixedLevelSentAtMs = 0;

const AUDIO_LEVEL_SEND_INTERVAL_MS = 200;

function calculatePcmDurationMs(byteLength: number, sampleRate: number, channels: number): number {
  if (!Number.isFinite(byteLength) || byteLength <= 0) return 0;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 0;
  if (!Number.isFinite(channels) || channels <= 0) return 0;

  const samples = byteLength / 2;
  return (samples / (sampleRate * channels)) * 1000;
}

function estimateBase64ByteLength(base64: string): number {
  if (!base64) return 0;
  const normalized = base64.trim();
  if (!normalized) return 0;

  const paddingMatch = normalized.match(/=+$/);
  const paddingLength = paddingMatch ? paddingMatch[0].length : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - paddingLength);
}

function flushAudioProgress(): void {
  audioProgressFlushTimer = null;

  if (pendingAudioDurationMs <= 0) return;

  notifyServiceWorker({ type: 'AUDIO_PROGRESS', durationMs: pendingAudioDurationMs });
  pendingAudioDurationMs = 0;
}

function queueAudioProgress(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;

  pendingAudioDurationMs += durationMs;
  if (audioProgressFlushTimer !== null) return;

  audioProgressFlushTimer = window.setTimeout(() => {
    flushAudioProgress();
  }, 300);
}

function resetAudioProgress(): void {
  pendingAudioDurationMs = 0;
  if (audioProgressFlushTimer !== null) {
    clearTimeout(audioProgressFlushTimer);
    audioProgressFlushTimer = null;
  }
}

function analyzePcmSignal(buffer: ArrayBuffer): { rms: number; peak: number } {
  const samples = new Int16Array(buffer);
  if (samples.length === 0) {
    return { rms: 0, peak: 0 };
  }

  let sumSquares = 0;
  let maxPeak = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const normalized = samples[index] / 32768;
    const absValue = Math.abs(normalized);
    if (absValue > maxPeak) {
      maxPeak = absValue;
    }
    sumSquares += normalized * normalized;
  }

  return {
    rms: Math.sqrt(sumSquares / samples.length),
    peak: maxPeak,
  };
}

function maybeSendMixedAudioLevel(buffer: ArrayBuffer): void {
  const now = Date.now();
  if (now - lastMixedLevelSentAtMs < AUDIO_LEVEL_SEND_INTERVAL_MS) {
    return;
  }

  const signal = analyzePcmSignal(buffer);
  lastMixedLevelSentAtMs = now;

  notifyServiceWorker({
    type: 'MIXED_AUDIO_LEVEL',
    rms: signal.rms,
    peak: signal.peak,
    timestamp: now,
  });
}

// Connect to WebSocket
function connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }

    const newWs = new WebSocket(WS_URL);
    let resolved = false;
    let rejected = false;

    newWs.onopen = () => {
      console.log('WebSocket connected');
      ws = newWs;
      wsCloseInitiator = 'remote-or-unknown';
      notifyServiceWorker({ type: 'WS_STATUS', status: 'connected' });
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    newWs.onmessage = (event) => {
      try {
        const message: ServerMessage = JSON.parse(event.data);
        console.log('Received from server:', message);

        if (message.type === 'status' && message.sessionId) {
          sessionId = message.sessionId;
        }

        notifyServiceWorker({ type: 'WS_MESSAGE', message });
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };

    newWs.onerror = (error) => {
      console.error('WebSocket error:', error);
      // Don't reject immediately - wait for onclose
      // The error event doesn't provide much info, onclose will tell us more
    };

    newWs.onclose = (event) => {
      const closeInfo = {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        initiator: wsCloseInitiator,
      };
      console.log('WebSocket closed', closeInfo);
      
      // If connection failed during connect attempt, reject the promise
      if (!resolved && !rejected) {
        rejected = true;
        // Only reject if it's a connection error (not normal closure)
        if (event.code !== 1000) {
          reject(new Error(`Connection failed: ${event.reason || `code ${event.code}`}`));
        } else {
          reject(new Error('Connection closed'));
        }
      }
      
      // Stop capture if it was running
      if (workletNode) {
        stopCapture();
      }
      
      // Notify service worker about disconnection
      if (ws === newWs) {
        notifyServiceWorker({ type: 'WS_STATUS', status: 'disconnected', closeInfo });
        ws = null;
      }
      
      // No automatic reconnection - user will click "Start Recording" to reconnect
    };
  });
}

// Disconnect WebSocket
function disconnect(reason = 'disconnect-called') {
  if (ws) {
    wsCloseInitiator = reason;
    ws.close(1000, reason);
    ws = null;
  }
  resetAudioProgress();
  stopCapture();
}

// Send message to WebSocket
function sendMessage(message: ClientMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// Start audio capture
async function startCapture(streamIdOrStream?: string | MediaStream) {
  try {
    // Stop any existing capture first
    if (workletNode || mediaStream || audioContext) {
      console.log('Stopping existing capture before starting new one');
      stopCapture();
      // Wait a bit for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    let stream: MediaStream;

    // If we received a streamId (string), use getUserMedia with it
    // This is the fastest approach when streamId is obtained in popup
    if (typeof streamIdOrStream === 'string') {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: streamIdOrStream,
          },
        } as any,
        video: false,
      });
    } else if (streamIdOrStream instanceof MediaStream) {
      // Use provided stream directly (for backward compatibility)
      stream = streamIdOrStream;
    } else {
      throw new Error('No stream ID or media stream provided');
    }

    await processStream(stream);
  } catch (err) {
    console.error('Failed to start capture:', err);
    notifyServiceWorker({ type: 'CAPTURE_STATUS', status: 'error', error: (err as Error).message });
    throw err;
  }
}

// Process the media stream
async function processStream(stream: MediaStream) {
  // Check if stream has audio
  if (stream.getAudioTracks().length === 0) {
    throw new Error('No audio tracks found in stream');
  }

  mediaStream = stream;

  // IMPORTANT: Play back the captured audio so user can hear it
  // Create an audio element and set its source to the captured stream
  const audioElement = new Audio();
  audioElement.srcObject = mediaStream;
  audioElement.play().catch(err => console.warn('Failed to play back audio:', err));
  console.log('Audio playback started via Audio element');

  // Create audio context for processing (transcription)
  audioContext = new AudioContext({ sampleRate: 16000 });

  // Load worklet
  await audioContext.audioWorklet.addModule(chrome.runtime.getURL('processor.worklet.js'));

  // Create nodes
  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  workletNode = new AudioWorkletNode(audioContext, 'audio-processor');

  // Handle audio chunks
  workletNode.port.onmessage = (event) => {
    if (event.data.type === 'audio-chunk') {
      const chunk = event.data.chunk as ArrayBuffer;
      maybeSendMixedAudioLevel(chunk);

      if (!sessionId || !ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      const base64 = arrayBufferToBase64(chunk);
      const durationMs = calculatePcmDurationMs(chunk.byteLength, 16000, 1);

      sendMessage({
        type: 'audio',
        sessionId,
        sampleRate: 16000,
        channels: 1,
        chunk: base64,
      });

      queueAudioProgress(durationMs);
    }
  };

  // Connect nodes - only for processing, not playback
  sourceNode.connect(workletNode);

  console.log('Audio capture started');
  notifyServiceWorker({ type: 'CAPTURE_STATUS', status: 'recording' });
}

// Stop audio capture
function stopCapture() {
  resetAudioProgress();
  lastMixedLevelSentAtMs = 0;

  // Disconnect worklet node first
  if (workletNode) {
    try {
      workletNode.port.onmessage = null;
      workletNode.disconnect();
    } catch (err) {
      console.warn('Error disconnecting worklet node:', err);
    }
    workletNode = null;
  }

  // Disconnect source node
  if (sourceNode) {
    try {
      sourceNode.disconnect();
    } catch (err) {
      console.warn('Error disconnecting source node:', err);
    }
    sourceNode = null;
  }

  // Stop media stream tracks
  if (mediaStream) {
    try {
      mediaStream.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
    } catch (err) {
      console.warn('Error stopping media stream tracks:', err);
    }
    mediaStream = null;
  }

  // Close audio context
  if (audioContext) {
    try {
      audioContext.close();
    } catch (err) {
      console.warn('Error closing audio context:', err);
    }
    audioContext = null;
  }

  console.log('Audio capture stopped');
  notifyServiceWorker({ type: 'CAPTURE_STATUS', status: 'stopped' });
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

// Notify service worker
function notifyServiceWorker(message: object) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Service worker might be inactive
  });
}

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('Offscreen received:', message.type);

  switch (message.type) {
    case 'OFFSCREEN_CONNECT':
      // If already connected, just return success
      if (ws && ws.readyState === WebSocket.OPEN) {
        sendResponse({ success: true });
        return true;
      }
      
      connect()
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          console.error('Connection error:', err);
          sendResponse({ error: err.message || 'Failed to connect to server' });
        });
      return true;

    case 'OFFSCREEN_DISCONNECT':
      console.log('Offscreen disconnect requested', { reason: message.reason || 'offscreen-disconnect' });
      disconnect(message.reason || 'offscreen-disconnect');
      sendResponse({ success: true });
      return true;

    case 'OFFSCREEN_START_SESSION':
      // Check if WebSocket is connected
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        sendResponse({ error: 'WebSocket is not connected. Please connect first.' });
        return true;
      }
      sendMessage({
        type: 'start',
        language: message.language || 'ru-RU',
        platform: message.platform,
        audioMode: message.audioMode,
        token: message.token,
      } as any);
      sendResponse({ success: true });
      return true;

    case 'OFFSCREEN_SPEAKER_UPDATE':
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        sendResponse({ error: 'WebSocket is not connected. Please connect first.' });
        return true;
      }
      if (!message.sessionId) {
        sendResponse({ error: 'No sessionId provided' });
        return true;
      }

      sendMessage({
        type: 'speaker',
        sessionId: message.sessionId,
        speaker: message.speaker ?? null,
        participantId: message.participantId,
        timestamp: Date.now(),
      } as any);

      sendResponse({ success: true });
      return true;

    case 'OFFSCREEN_TRACK_AUDIO_CHUNK':
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        sendResponse({ error: 'WebSocket is not connected. Please connect first.' });
        return true;
      }

      if (!message.sessionId || !message.chunk) {
        sendResponse({ error: 'Invalid track audio chunk payload' });
        return true;
      }

      sendMessage({
        type: 'audio',
        sessionId: message.sessionId,
        sampleRate: message.sampleRate || 16000,
        channels: message.channels || 1,
        chunk: message.chunk,
        participantId: message.participantId,
        speaker: message.speaker ?? null,
      } as any);

      const byteLength = estimateBase64ByteLength(message.chunk);
      const durationMs = calculatePcmDurationMs(
        byteLength,
        message.sampleRate || 16000,
        message.channels || 1,
      );
      queueAudioProgress(durationMs);

      sendResponse({ success: true });
      return true;

    case 'OFFSCREEN_STOP_SESSION':
      console.log('Offscreen stop session requested', { sessionId, reason: message.reason || 'offscreen-stop-session' });
      // Stop capture first
      stopCapture();
      // Then stop session
      if (sessionId) {
        sendMessage({ type: 'stop', sessionId });
        sessionId = null;
      }
      sendResponse({ success: true });
      return true;

    case 'OFFSCREEN_START_CAPTURE':
      startCapture(message.streamId || message.stream)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case 'OFFSCREEN_STOP_CAPTURE':
      stopCapture();
      sendResponse({ success: true });
      return true;

    case 'OFFSCREEN_GET_STATUS':
      sendResponse({
        wsConnected: ws !== null && ws.readyState === WebSocket.OPEN,
        sessionId,
        capturing: workletNode !== null,
      });
      return true;

    default:
      return false;
  }
});

console.log('Offscreen document ready');
