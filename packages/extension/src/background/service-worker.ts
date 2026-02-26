// Background service worker for LiveScribe extension
// Coordinates between popup and offscreen document

import { getPlatformCapabilities, resolveAudioMode } from '../platform/audio-mode-capabilities';

console.log('LiveScribe background service worker initialized');

// State
let currentStatus: 'idle' | 'connected' | 'recording' | 'error' = 'idle';
let sessionId: string | null = null;
let offscreenCreated = false;
let recordingTabId: number | null = null;
let recordingSegmentStartedAtMs: number | null = null;
let recordingAccumulatedMs = 0;
let deepgramAudioSentMs = 0;
let currentAudioMode: 'mixed' | 'per-track' = 'mixed';
let activeRecordingStartMessage: {
  language?: string;
  platform?: string;
  audioMode?: 'mixed' | 'per-track';
} | null = null;
let perTrackRecoveryInProgress = false;

interface TrackSpeakerLevel {
  participantId: string;
  speaker: string | null;
  rms: number;
  peak: number;
  timestamp: number;
}

let mixedAudioLevel: { rms: number; peak: number; timestamp: number } | null = null;
const perTrackAudioLevels = new Map<string, TrackSpeakerLevel>();

const AUDIO_LEVELS_TTL_MS = 3000;
const AUDIO_LEVELS_EMA_ALPHA = 0.25;
const AUDIO_LEVELS_MAX_SPEAKERS = 8;

function resetAudioMetrics(options?: { keepRunning?: boolean }): void {
  const keepRunning = options?.keepRunning === true;
  recordingAccumulatedMs = 0;
  deepgramAudioSentMs = 0;
  if (keepRunning && currentStatus === 'recording') {
    recordingSegmentStartedAtMs = Date.now();
  } else {
    recordingSegmentStartedAtMs = null;
  }
}

function beginAudioMetrics(): void {
  if (recordingSegmentStartedAtMs === null) {
    recordingSegmentStartedAtMs = Date.now();
  }
}

function pauseAudioMetrics(): void {
  if (recordingSegmentStartedAtMs === null) return;
  recordingAccumulatedMs += Math.max(0, Date.now() - recordingSegmentStartedAtMs);
  recordingSegmentStartedAtMs = null;
}

function getAudioMetricsSnapshot() {
  const currentSegmentMs =
    recordingSegmentStartedAtMs !== null ? Math.max(0, Date.now() - recordingSegmentStartedAtMs) : 0;
  const recordingTotalMs = recordingAccumulatedMs + currentSegmentMs;

  return {
    recordingStartedAtMs: recordingSegmentStartedAtMs,
    recordingSeconds: Math.max(0, Math.floor(recordingTotalMs / 1000)),
    deepgramSeconds: Math.max(0, Math.floor(deepgramAudioSentMs / 1000)),
  };
}

function forwardToContentScript(message: object): void {
  const sendToTab = (tabId: number) => {
    chrome.tabs.sendMessage(tabId, message).catch(() => {
      // Content script might not be ready, that's ok.
    });
  };

  if (recordingTabId !== null) {
    sendToTab(recordingTabId);
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      sendToTab(tabs[0].id);
    }
  });
}

function broadcastAudioMetrics(): void {
  forwardToContentScript({ type: 'CONTENT_AUDIO_METRICS', ...getAudioMetricsSnapshot() });
}

function resetAudioLevels(): void {
  mixedAudioLevel = null;
  perTrackAudioLevels.clear();
}

function normalizeLevel(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function buildAudioLevelsSnapshot() {
  const now = Date.now();

  for (const [participantId, entry] of perTrackAudioLevels.entries()) {
    if (now - entry.timestamp > AUDIO_LEVELS_TTL_MS) {
      perTrackAudioLevels.delete(participantId);
    }
  }

  const speakers = [...perTrackAudioLevels.values()]
    .sort((first, second) => second.rms - first.rms)
    .slice(0, AUDIO_LEVELS_MAX_SPEAKERS)
    .map((entry) => ({
      participantId: entry.participantId,
      speaker: entry.speaker,
      rms: entry.rms,
      peak: entry.peak,
      timestamp: entry.timestamp,
    }));

  return {
    mode: currentAudioMode,
    mixed: mixedAudioLevel,
    speakers,
  };
}

function broadcastAudioLevels(): void {
  const snapshot = buildAudioLevelsSnapshot();
  forwardToContentScript({
    type: 'CONTENT_AUDIO_LEVELS',
    mode: snapshot.mode,
    mixed: snapshot.mixed,
    speakers: snapshot.speakers,
  });
}

function broadcastWsRecoveryStatus(reason?: string): void {
  forwardToContentScript({
    type: 'CONTENT_WS_RECOVERY_STATUS',
    recovering: perTrackRecoveryInProgress,
    reason: reason || null,
  });
}

// Create offscreen document
async function ensureOffscreen() {
  if (offscreenCreated) return;

  try {
    // Check if offscreen document already exists
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });

    if (existingContexts.length > 0) {
      offscreenCreated = true;
      return;
    }

    // Create offscreen document
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'WebSocket session and media processing for transcription',
    });

    offscreenCreated = true;
    console.log('Offscreen document created');
  } catch (err) {
    console.error('Failed to create offscreen document:', err);
    throw err;
  }
}

// Send message to offscreen document
async function sendToOffscreen(message: object): Promise<any> {
  await ensureOffscreen();
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (err: any) {
    // If offscreen document was closed, reset flag
    if (err.message?.includes('Receiving end does not exist')) {
      console.log('Offscreen document was closed, resetting flag');
      offscreenCreated = false;
      // Try one more time after resetting
      await ensureOffscreen();
      return await chrome.runtime.sendMessage(message);
    }
    throw err;
  }
}

async function recoverPerTrackSession(reason: string): Promise<void> {
  if (perTrackRecoveryInProgress) return;
  if (currentAudioMode !== 'per-track' || !activeRecordingStartMessage) return;

  perTrackRecoveryInProgress = true;
  broadcastWsRecoveryStatus(reason);
  try {
    console.warn('Attempting per-track WS/session recovery', {
      reason,
      sessionId,
      currentStatus,
      recordingTabId,
    });

    const connectResponse = await sendToOffscreen({ type: 'OFFSCREEN_CONNECT' });
    if (connectResponse?.error) {
      throw new Error(connectResponse.error);
    }

    const startResponse = await sendToOffscreen({
      type: 'OFFSCREEN_START_SESSION',
      language: activeRecordingStartMessage.language || 'ru-RU',
      platform: activeRecordingStartMessage.platform,
      audioMode: 'per-track',
    });

    if (startResponse?.error) {
      throw new Error(startResponse.error);
    }

    currentStatus = 'recording';
    beginAudioMetrics();
    console.warn('Per-track WS/session recovery completed');
  } catch (err) {
    console.error('Per-track WS/session recovery failed:', err);
  } finally {
    perTrackRecoveryInProgress = false;
    broadcastWsRecoveryStatus();
  }
}

// Helper function for offscreen recording
function startRecordingOffscreen(message: any, sendResponse: (response: any) => void) {
  const platformCapabilities = getPlatformCapabilities(message.platform);
  const audioMode = resolveAudioMode(message.audioMode);
  currentAudioMode = audioMode;
  resetAudioLevels();
  broadcastAudioLevels();
  const shouldSkipTabCapture =
    platformCapabilities.supportsPerTrackAudioMode && audioMode === 'per-track';

  console.log('startRecordingOffscreen mode', {
    platform: message.platform,
    audioMode,
    shouldSkipTabCapture,
    supportsPerTrackAudioMode: platformCapabilities.supportsPerTrackAudioMode,
    supportsMixedCapture: platformCapabilities.supportsMixedCapture,
    hasProvidedStreamId: Boolean(message.streamId),
  });

  const startCaptureWithActiveStreamRecovery = (streamId: string) => {
    sendToOffscreen({ type: 'OFFSCREEN_START_CAPTURE', streamId })
      .then((response) => {
        const errorMessage = response?.error || '';
        const isActiveStreamError =
          typeof errorMessage === 'string' && errorMessage.toLowerCase().includes('active stream');

        if (!isActiveStreamError) {
          if (!response.error) {
            currentStatus = 'recording';
            beginAudioMetrics();
            broadcastAudioMetrics();
          }
          sendResponse(response);
          return;
        }

        console.warn('Detected active stream capture conflict, attempting recovery retry...');

        sendToOffscreen({ type: 'OFFSCREEN_STOP_CAPTURE' })
          .catch(() => {
            // Best effort cleanup.
          })
          .finally(() => {
            setTimeout(() => {
              sendToOffscreen({ type: 'OFFSCREEN_START_CAPTURE', streamId })
                .then((retryResponse) => {
                  if (!retryResponse.error) {
                    currentStatus = 'recording';
                    beginAudioMetrics();
                    broadcastAudioMetrics();
                  }
                  sendResponse(retryResponse);
                })
                .catch((retryErr) => sendResponse({ error: retryErr.message }));
            }, 250);
          });
      })
      .catch((err) => sendResponse({ error: err.message }));
  };

  // If streamId is provided from popup, use it directly
  if (message.streamId) {
    sendToOffscreen({ type: 'OFFSCREEN_CONNECT' })
      .then((connectResponse) => {
        if (connectResponse && connectResponse.error) {
          sendResponse({ error: connectResponse.error });
          return;
        }
        
        setTimeout(() => {
          sendToOffscreen({
            type: 'OFFSCREEN_START_SESSION',
            language: message.language || 'ru-RU',
            platform: message.platform,
            audioMode,
          })
            .then((sessionResponse) => {
              if (sessionResponse && sessionResponse.error) {
                sendResponse({ error: sessionResponse.error });
                return;
              }

              setTimeout(() => {
                if (shouldSkipTabCapture) {
                  currentStatus = 'recording';
                  beginAudioMetrics();
                  broadcastAudioMetrics();
                  sendResponse({ success: true });
                  return;
                }

                startCaptureWithActiveStreamRecovery(message.streamId);
              }, 100);
            })
            .catch((err) => sendResponse({ error: err.message }));
        }, 200);
      })
      .catch((err) => sendResponse({ error: err.message }));
    return;
  }

  // Fallback: Get active tab and streamId in service worker
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) {
      sendResponse({ error: 'No active tab found' });
      return;
    }

    chrome.tabCapture.getMediaStreamId(
      { targetTabId: tabs[0].id },
      (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          sendResponse({ error: chrome.runtime.lastError?.message || 'Failed to get media stream ID' });
          return;
        }

        sendToOffscreen({ type: 'OFFSCREEN_CONNECT' })
          .then(() => {
            setTimeout(() => {
              sendToOffscreen({
                type: 'OFFSCREEN_START_SESSION',
                language: message.language || 'ru-RU',
                platform: message.platform,
                audioMode,
              })
                .then(() => {
                  setTimeout(() => {
                    if (shouldSkipTabCapture) {
                      currentStatus = 'recording';
                      beginAudioMetrics();
                      broadcastAudioMetrics();
                      sendResponse({ success: true });
                      return;
                    }

                    startCaptureWithActiveStreamRecovery(streamId);
                  }, 100);
                })
                .catch((err) => sendResponse({ error: err.message }));
            }, 200);
          })
          .catch((err) => sendResponse({ error: err.message }));
      }
    );
  });
}

// Helper function for stopping offscreen recording
function stopRecordingOffscreen(sendResponse: (response: any) => void, reason = 'unknown') {
  console.log('stopRecordingOffscreen called', { reason, currentStatus, sessionId, recordingTabId });

  sendToOffscreen({ type: 'OFFSCREEN_STOP_SESSION', reason })
    .then(() => {
      return sendToOffscreen({ type: 'OFFSCREEN_DISCONNECT', reason: `stopRecordingOffscreen:${reason}` });
    })
    .then((response) => {
      currentStatus = 'idle';
      sessionId = null;
      activeRecordingStartMessage = null;
      perTrackRecoveryInProgress = false;
      broadcastWsRecoveryStatus();
      pauseAudioMetrics();
      resetAudioLevels();
      broadcastAudioMetrics();
      broadcastAudioLevels();
      sendResponse(response);
    })
    .catch((err) => {
      currentStatus = 'idle';
      sessionId = null;
      activeRecordingStartMessage = null;
      perTrackRecoveryInProgress = false;
      broadcastWsRecoveryStatus();
      pauseAudioMetrics();
      resetAudioLevels();
      broadcastAudioMetrics();
      broadcastAudioLevels();
      sendResponse({ error: err.message });
    });
}

// Handle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Status updates from offscreen document
  if (message.type === 'WS_STATUS') {
    console.log('WebSocket status:', message.status, message.closeInfo || null);
    const previousStatus = currentStatus;
    
    if (message.status === 'connected') {
      if (activeRecordingStartMessage && recordingSegmentStartedAtMs === null) {
        beginAudioMetrics();
      }
      if (activeRecordingStartMessage && currentStatus === 'idle') {
        currentStatus = 'recording';
      }
      // Don't change status if we're recording - WebSocket can reconnect during recording
      // Also don't change status during START_RECORDING process
      if (currentStatus !== 'recording' && currentStatus !== 'idle') {
        currentStatus = 'idle'; // Keep as idle, not connected (simplified states)
        sessionId = null;
      }
    } else if (message.status === 'disconnected') {
      // If we were recording, stop it first
      if (currentStatus === 'recording') {
        if (currentAudioMode === 'per-track') {
          recoverPerTrackSession(`ws-disconnected:${message.closeInfo?.code ?? 'no-code'}`).catch(() => {});
          return false;
        }

        console.warn('WS disconnected while recording, requesting OFFSCREEN_STOP_SESSION', {
          closeInfo: message.closeInfo || null,
          sessionId,
          recordingTabId,
        });
        sendToOffscreen({
          type: 'OFFSCREEN_STOP_SESSION',
          reason: `ws-disconnected:${message.closeInfo?.code ?? 'no-code'}`,
        }).catch(() => {});
      }
      // Only update status if not already idle (to avoid unnecessary updates)
      if (currentStatus !== 'idle') {
        currentStatus = 'idle';
        sessionId = null;
        pauseAudioMetrics();
        resetAudioLevels();
        broadcastAudioMetrics();
        broadcastAudioLevels();
      }
    } else if (message.status === 'error') {
      // Don't change status to error during connection attempt
      // Only change if we were actually connected/recording before
      if (currentStatus === 'recording') {
        sendToOffscreen({ type: 'OFFSCREEN_STOP_SESSION' }).catch(() => {});
        currentStatus = 'idle';
        sessionId = null;
        pauseAudioMetrics();
        resetAudioLevels();
        broadcastAudioMetrics();
        broadcastAudioLevels();
      }
      // If status is already idle, don't change it (connection attempt failed, but we're already idle)
    }
    
    // Only log if status actually changed
    if (previousStatus !== currentStatus) {
      console.log(`Status changed: ${previousStatus} -> ${currentStatus}`);
    }
    return false;
  }

  if (message.type === 'WS_MESSAGE') {
    const wsMessage = message.message;
    if (wsMessage.type === 'status' && wsMessage.sessionId) {
      sessionId = wsMessage.sessionId;
      currentStatus = wsMessage.status;
    }

    // Forward websocket messages to the tab where recording was started.
    // Content script needs `status` to receive `sessionId` for speaker updates.
    if (wsMessage.type === 'status' || wsMessage.type === 'partial' || wsMessage.type === 'final' || wsMessage.type === 'error') {
      forwardToContentScript({ type: 'WS_MESSAGE', message: wsMessage });
    }
    return false;
  }

  if (message.type === 'AUDIO_PROGRESS') {
    if (
      activeRecordingStartMessage !== null &&
      typeof message.durationMs === 'number' &&
      Number.isFinite(message.durationMs) &&
      message.durationMs > 0
    ) {
      if (recordingSegmentStartedAtMs === null) {
        beginAudioMetrics();
      }
      deepgramAudioSentMs += message.durationMs;
      broadcastAudioMetrics();
    }
    return false;
  }

  if (message.type === 'MIXED_AUDIO_LEVEL') {
    if (currentStatus !== 'recording' || currentAudioMode !== 'mixed') {
      return false;
    }

    const rmsInput = normalizeLevel(message.rms);
    const peakInput = normalizeLevel(message.peak);

    if (!mixedAudioLevel) {
      mixedAudioLevel = {
        rms: rmsInput,
        peak: peakInput,
        timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
      };
    } else {
      mixedAudioLevel = {
        rms: mixedAudioLevel.rms * (1 - AUDIO_LEVELS_EMA_ALPHA) + rmsInput * AUDIO_LEVELS_EMA_ALPHA,
        peak: mixedAudioLevel.peak * (1 - AUDIO_LEVELS_EMA_ALPHA) + peakInput * AUDIO_LEVELS_EMA_ALPHA,
        timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
      };
    }

    broadcastAudioLevels();
    return false;
  }

  if (message.type === 'TRACK_AUDIO_LEVEL') {
    if (currentStatus !== 'recording' || currentAudioMode !== 'per-track') {
      return false;
    }

    if (typeof message.participantId !== 'string' || !message.participantId) {
      return false;
    }

    const existing = perTrackAudioLevels.get(message.participantId);
    const rmsInput = normalizeLevel(message.rms);
    const peakInput = normalizeLevel(message.peak);
    const timestamp = typeof message.timestamp === 'number' ? message.timestamp : Date.now();

    if (!existing) {
      perTrackAudioLevels.set(message.participantId, {
        participantId: message.participantId,
        speaker: typeof message.speaker === 'string' && message.speaker.trim() ? message.speaker : null,
        rms: rmsInput,
        peak: peakInput,
        timestamp,
      });
    } else {
      perTrackAudioLevels.set(message.participantId, {
        participantId: existing.participantId,
        speaker:
          typeof message.speaker === 'string' && message.speaker.trim()
            ? message.speaker
            : existing.speaker,
        rms: existing.rms * (1 - AUDIO_LEVELS_EMA_ALPHA) + rmsInput * AUDIO_LEVELS_EMA_ALPHA,
        peak: existing.peak * (1 - AUDIO_LEVELS_EMA_ALPHA) + peakInput * AUDIO_LEVELS_EMA_ALPHA,
        timestamp,
      });
    }

    broadcastAudioLevels();
    return false;
  }

  if (message.type === 'CAPTURE_STATUS') {
    console.log('Capture status:', message.status);
    if (message.status === 'recording') {
      currentStatus = 'recording';
    } else if (message.status === 'stopped') {
      // Only update to idle if we were recording
      if (currentStatus === 'recording') {
        currentStatus = 'idle';
        pauseAudioMetrics();
        resetAudioLevels();
        broadcastAudioMetrics();
        broadcastAudioLevels();
      }
    }
    return false;
  }

  // Handle popup messages
  console.log('Received message:', message.type);

  if (message.type === 'CONNECT') {
    sendToOffscreen({ type: 'OFFSCREEN_CONNECT' })
      .then((response) => sendResponse(response))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'START_RECORDING') {
    if (sender.tab?.id) {
      recordingTabId = sender.tab.id;
    }
    currentAudioMode = resolveAudioMode(message.audioMode);
    activeRecordingStartMessage = {
      language: message.language,
      platform: message.platform,
      audioMode: currentAudioMode,
    };
    perTrackRecoveryInProgress = false;
    broadcastWsRecoveryStatus();
    resetAudioLevels();
    broadcastAudioLevels();

    // Check if we are really recording or just have stale state.
    if (currentStatus === 'recording') {
      sendToOffscreen({ type: 'OFFSCREEN_GET_STATUS' })
        .then((offscreenStatus) => {
          if (offscreenStatus?.capturing) {
            sendResponse({ error: 'Recording already in progress' });
            return;
          }

          // Stale state: allow fresh start
          currentStatus = 'idle';
          sessionId = null;
          startRecordingOffscreen(message, sendResponse);
        })
        .catch(() => {
          // If status check fails, try to recover by attempting a fresh start
          currentStatus = 'idle';
          sessionId = null;
          startRecordingOffscreen(message, sendResponse);
        });
      return true;
    }

    // Use offscreen document with tabCapture (user will hear audio)
    startRecordingOffscreen(message, sendResponse);
    return true;
  }

  if (message.type === 'SPEAKER_UPDATE') {
    // Forward speaker updates to offscreen (it holds the WS connection)
    sendToOffscreen({
      type: 'OFFSCREEN_SPEAKER_UPDATE',
      sessionId: message.sessionId,
      speaker: message.speaker,
      participantId: message.participantId,
    }).catch(() => {
      // ignore
    });
    return false;
  }

  if (message.type === 'TRACK_AUDIO_CHUNK') {
    sendToOffscreen({
      type: 'OFFSCREEN_TRACK_AUDIO_CHUNK',
      sessionId: message.sessionId,
      participantId: message.participantId,
      speaker: message.speaker,
      sampleRate: message.sampleRate,
      channels: message.channels,
      chunk: message.chunk,
    })
      .then((response) => {
        if (
          response?.error &&
          currentAudioMode === 'per-track' &&
          typeof response.error === 'string' &&
          response.error.includes('WebSocket is not connected')
        ) {
          recoverPerTrackSession('track-audio-chunk-no-ws').catch(() => {});
        }
      })
      .catch(() => {
        // ignore
      });
    return false;
  }

  if (message.type === 'STOP_RECORDING') {
    console.log('STOP_RECORDING received', {
      senderTabId: sender.tab?.id ?? null,
      recordingTabId,
      sessionId,
      currentStatus,
    });
    recordingTabId = null;
    activeRecordingStartMessage = null;
    perTrackRecoveryInProgress = false;
    broadcastWsRecoveryStatus();
    resetAudioLevels();
    broadcastAudioLevels();

    // Stop recording via offscreen document
    stopRecordingOffscreen(sendResponse, 'stop-recording-message');
    return true;
  }


  if (message.type === 'GET_STATUS') {
    // Try content script first, then offscreen
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'CONTENT_GET_STATUS' }, (response) => {
          if (!chrome.runtime.lastError && response) {
            // Content script responded
            currentStatus = response.status === 'recording' ? 'recording' : 'idle';
            sessionId = response.sessionId || null;
            sendResponse({
              status: currentStatus,
              sessionId,
              wsRecovering: perTrackRecoveryInProgress,
              ...getAudioMetricsSnapshot(),
            });
            return;
          }

          // Fallback to offscreen
          sendToOffscreen({ type: 'OFFSCREEN_GET_STATUS' })
            .then((offscreenStatus) => {
              if (offscreenStatus && !offscreenStatus.wsConnected && currentStatus === 'connected') {
                console.log('WebSocket not connected but status is connected, fixing...');
                currentStatus = 'idle';
                sessionId = null;
              }
              sendResponse({
                status: currentStatus,
                sessionId,
                wsRecovering: perTrackRecoveryInProgress,
                ...getAudioMetricsSnapshot(),
              });
            })
            .catch(() => {
              console.log('Could not reach offscreen, returning current status:', currentStatus);
              sendResponse({
                status: currentStatus,
                sessionId,
                wsRecovering: perTrackRecoveryInProgress,
                ...getAudioMetricsSnapshot(),
              });
            });
        });
      } else {
        // No active tab, use offscreen
        sendToOffscreen({ type: 'OFFSCREEN_GET_STATUS' })
          .then((offscreenStatus) => {
            if (offscreenStatus && !offscreenStatus.wsConnected && currentStatus === 'connected') {
              currentStatus = 'idle';
              sessionId = null;
            }
            sendResponse({
              status: currentStatus,
              sessionId,
              wsRecovering: perTrackRecoveryInProgress,
              ...getAudioMetricsSnapshot(),
            });
          })
          .catch(() => {
            sendResponse({
              status: currentStatus,
              sessionId,
              wsRecovering: perTrackRecoveryInProgress,
              ...getAudioMetricsSnapshot(),
            });
          });
      }
    });
    return true;
  }

  if (message.type === 'GET_STREAM_ID') {
    // Get streamId for content script fallback
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        sendResponse({ error: 'No active tab found' });
        return;
      }

      chrome.tabCapture.getMediaStreamId({ targetTabId: tabs[0].id }, (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          sendResponse({ error: chrome.runtime.lastError?.message || 'Failed to get stream ID' });
          return;
        }
        sendResponse({ streamId });
      });
    });
    return true;
  }

  if (message.type === 'CONTENT_STATUS_UPDATE') {
    // Status update from content script
    currentStatus = message.status;
    if (message.sessionId) {
      sessionId = message.sessionId;
    }
    return false;
  }

  if (message.type === 'RESET_RECORDING_STATE') {
    resetAudioMetrics({ keepRunning: message.keepRunning === true });
    resetAudioLevels();
    broadcastAudioMetrics();
    broadcastAudioLevels();
    sendResponse({ success: true, ...getAudioMetricsSnapshot() });
    return true;
  }

  if (message.type === 'TRANSCRIPT_UPDATE') {
    // Transcript update from content script - no longer needed
    return false;
  }

  if (message.type === 'DISCONNECT') {
    sendToOffscreen({ type: 'OFFSCREEN_DISCONNECT' })
      .then((response) => {
        currentStatus = 'idle';
        sessionId = null;
        activeRecordingStartMessage = null;
        perTrackRecoveryInProgress = false;
        broadcastWsRecoveryStatus();
        pauseAudioMetrics();
        resetAudioLevels();
        broadcastAudioMetrics();
        broadcastAudioLevels();
        sendResponse(response);
      })
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  return false;
});

// Handle extension icon click - toggle widget visibility
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) {
    console.error('No tab ID available');
    return;
  }
  
  console.log('Extension icon clicked, tab ID:', tab.id);
  
  try {
    // Send message to content script to toggle widget
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'CONTENT_TOGGLE_WIDGET' });
    console.log('Widget toggled:', response);
  } catch (err) {
    console.error('Failed to toggle widget:', err);
    // Content script might not be loaded, try to inject matching content-script files from runtime manifest
    try {
      const manifest = chrome.runtime.getManifest();
      const contentScriptEntry = manifest.content_scripts?.find((entry) =>
        entry.js?.some((scriptPath) => scriptPath.includes('content.js')),
      );

      if (!contentScriptEntry?.js?.length) {
        console.error('No content script entry found in manifest for fallback injection');
        return;
      }

      console.log('Attempting to inject content script files:', contentScriptEntry.js);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: contentScriptEntry.js,
      });
      console.log('Content script injected, waiting before toggle...');
      // Wait a bit and try again
      setTimeout(async () => {
        try {
          const response = await chrome.tabs.sendMessage(tab.id!, { type: 'CONTENT_TOGGLE_WIDGET' });
          console.log('Widget toggled after injection:', response);
        } catch (e) {
          console.error('Failed to toggle widget after injection:', e);
        }
      }, 500);
    } catch (injectErr) {
      console.error('Failed to inject content script:', injectErr);
    }
  }
});

// Keep service worker alive periodically
chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    console.log('Service worker keepalive');
  }
});

console.log('Service worker ready');
