// Background service worker for LiveScribe extension
// Coordinates between popup and offscreen document

import { getPlatformCapabilities, resolveAudioMode } from '../platform/audio-mode-capabilities';

console.log('LiveScribe background service worker initialized');

// State
let currentStatus: 'idle' | 'connected' | 'recording' | 'error' = 'idle';
let sessionId: string | null = null;
let offscreenCreated = false;
let recordingTabId: number | null = null;

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

// Helper function for offscreen recording
function startRecordingOffscreen(message: any, sendResponse: (response: any) => void) {
  const platformCapabilities = getPlatformCapabilities(message.platform);
  const audioMode = resolveAudioMode(message.audioMode);
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
                  sendResponse({ success: true });
                  return;
                }

                sendToOffscreen({ type: 'OFFSCREEN_START_CAPTURE', streamId: message.streamId })
                  .then((response) => {
                    if (!response.error) {
                      currentStatus = 'recording';
                    }
                    sendResponse(response);
                  })
                  .catch((err) => sendResponse({ error: err.message }));
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
                      sendResponse({ success: true });
                      return;
                    }

                    sendToOffscreen({ type: 'OFFSCREEN_START_CAPTURE', streamId })
                      .then((response) => {
                        if (!response.error) {
                          currentStatus = 'recording';
                        }
                        sendResponse(response);
                      })
                      .catch((err) => sendResponse({ error: err.message }));
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
      sendResponse(response);
    })
    .catch((err) => {
      currentStatus = 'idle';
      sessionId = null;
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
      // Don't change status if we're recording - WebSocket can reconnect during recording
      // Also don't change status during START_RECORDING process
      if (currentStatus !== 'recording' && currentStatus !== 'idle') {
        currentStatus = 'idle'; // Keep as idle, not connected (simplified states)
        sessionId = null;
      }
    } else if (message.status === 'disconnected') {
      // If we were recording, stop it first
      if (currentStatus === 'recording') {
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
      }
    } else if (message.status === 'error') {
      // Don't change status to error during connection attempt
      // Only change if we were actually connected/recording before
      if (currentStatus === 'recording') {
        sendToOffscreen({ type: 'OFFSCREEN_STOP_SESSION' }).catch(() => {});
        currentStatus = 'idle';
        sessionId = null;
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
      const forwardToTab = (tabId: number) => {
        chrome.tabs.sendMessage(tabId, { type: 'WS_MESSAGE', message: wsMessage }).catch(() => {
          // Content script might not be ready, that's ok
        });
      };

      if (recordingTabId !== null) {
        forwardToTab(recordingTabId);
      } else {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            forwardToTab(tabs[0].id);
          }
        });
      }
    }
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
    }).catch(() => {
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
            sendResponse({ status: currentStatus, sessionId });
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
              sendResponse({ status: currentStatus, sessionId });
            })
            .catch(() => {
              console.log('Could not reach offscreen, returning current status:', currentStatus);
              sendResponse({ status: currentStatus, sessionId });
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
            sendResponse({ status: currentStatus, sessionId });
          })
          .catch(() => {
            sendResponse({ status: currentStatus, sessionId });
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

  if (message.type === 'TRANSCRIPT_UPDATE') {
    // Transcript update from content script - no longer needed
    return false;
  }

  if (message.type === 'DISCONNECT') {
    sendToOffscreen({ type: 'OFFSCREEN_DISCONNECT' })
      .then((response) => {
        currentStatus = 'idle';
        sessionId = null;
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
    // Content script might not be loaded, try to inject it
    try {
      console.log('Attempting to inject content script...');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/content/content.js'],
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
