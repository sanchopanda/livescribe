"use strict";
// Background service worker for LiveScribe extension
// Coordinates between popup and offscreen document
console.log('LiveScribe background service worker initialized');
// State
let currentStatus = 'idle';
let sessionId = null;
let offscreenCreated = false;
// Create offscreen document
async function ensureOffscreen() {
    if (offscreenCreated)
        return;
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
            reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
            justification: 'WebSocket connection and audio capture for transcription',
        });
        offscreenCreated = true;
        console.log('Offscreen document created');
    }
    catch (err) {
        console.error('Failed to create offscreen document:', err);
        throw err;
    }
}
// Send message to offscreen document
async function sendToOffscreen(message) {
    await ensureOffscreen();
    return chrome.runtime.sendMessage(message);
}
// Notify popup about updates
function notifyPopup(message) {
    console.log('Notifying popup:', message);
    chrome.runtime.sendMessage(message).catch((err) => {
        // Popup might be closed - this is normal
        console.log('Popup notification failed (popup might be closed):', err);
    });
}
// Handle messages
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Ignore messages from offscreen document that are status updates
    if (message.type === 'WS_STATUS') {
        console.log('WebSocket status:', message.status);
        const previousStatus = currentStatus;
        if (message.status === 'connected') {
            // Don't change status if we're recording - WebSocket can reconnect during recording
            // Also don't change status during START_RECORDING process
            if (currentStatus !== 'recording' && currentStatus !== 'idle') {
                currentStatus = 'idle'; // Keep as idle, not connected (simplified states)
                sessionId = null;
            }
        }
        else if (message.status === 'disconnected') {
            // If we were recording, stop it first
            if (currentStatus === 'recording') {
                sendToOffscreen({ type: 'OFFSCREEN_STOP_SESSION' }).catch(() => { });
            }
            // Only update status if not already idle (to avoid unnecessary updates)
            if (currentStatus !== 'idle') {
                currentStatus = 'idle';
                sessionId = null;
            }
        }
        else if (message.status === 'error') {
            // Don't change status to error during connection attempt
            // Only change if we were actually connected/recording before
            if (currentStatus === 'recording') {
                sendToOffscreen({ type: 'OFFSCREEN_STOP_SESSION' }).catch(() => { });
                currentStatus = 'idle';
                sessionId = null;
            }
            // If status is already idle, don't change it (connection attempt failed, but we're already idle)
        }
        // Only notify popup if status actually changed
        if (previousStatus !== currentStatus) {
            console.log(`Status changed: ${previousStatus} -> ${currentStatus}`);
            notifyPopup({ type: 'STATUS_UPDATE', status: currentStatus, sessionId });
        }
        return false;
    }
    if (message.type === 'WS_MESSAGE') {
        const wsMessage = message.message;
        if (wsMessage.type === 'status' && wsMessage.sessionId) {
            sessionId = wsMessage.sessionId;
            currentStatus = wsMessage.status;
        }
        notifyPopup({ type: 'STATUS_UPDATE', status: currentStatus, sessionId });
        return false;
    }
    if (message.type === 'CAPTURE_STATUS') {
        console.log('Capture status:', message.status);
        if (message.status === 'recording') {
            currentStatus = 'recording';
            notifyPopup({ type: 'STATUS_UPDATE', status: currentStatus });
        }
        else if (message.status === 'stopped') {
            // Only update to idle if we were recording
            if (currentStatus === 'recording') {
                currentStatus = 'idle';
                notifyPopup({ type: 'STATUS_UPDATE', status: currentStatus });
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
        // Check if already recording
        if (currentStatus === 'recording') {
            sendResponse({ error: 'Recording already in progress' });
            return true;
        }
        // If streamId is provided from popup, use it directly
        // This is faster because popup has user action context
        if (message.streamId) {
            // First, ensure WebSocket is connected
            sendToOffscreen({ type: 'OFFSCREEN_CONNECT' })
                .then((connectResponse) => {
                if (connectResponse && connectResponse.error) {
                    sendResponse({ error: connectResponse.error });
                    return;
                }
                // Small delay to ensure connection is established
                setTimeout(() => {
                    // Start WebSocket session
                    sendToOffscreen({ type: 'OFFSCREEN_START_SESSION', language: 'ru-RU' })
                        .then((sessionResponse) => {
                        if (sessionResponse && sessionResponse.error) {
                            sendResponse({ error: sessionResponse.error });
                            return;
                        }
                        // Small delay to wait for session ID
                        setTimeout(() => {
                            // Pass streamId to offscreen document and start capture
                            sendToOffscreen({ type: 'OFFSCREEN_START_CAPTURE', streamId: message.streamId })
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
                }, 200);
            })
                .catch((err) => sendResponse({ error: err.message }));
            return true;
        }
        // Fallback: Get active tab and streamId in service worker (slower)
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]?.id) {
                sendResponse({ error: 'No active tab found' });
                return;
            }
            const tabId = tabs[0].id;
            chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
                if (chrome.runtime.lastError || !streamId) {
                    sendResponse({ error: chrome.runtime.lastError?.message || 'Failed to get media stream ID' });
                    return;
                }
                // First, ensure WebSocket is connected
                sendToOffscreen({ type: 'OFFSCREEN_CONNECT' })
                    .then(() => {
                    setTimeout(() => {
                        // Start WebSocket session
                        sendToOffscreen({ type: 'OFFSCREEN_START_SESSION', language: 'ru-RU' })
                            .then(() => {
                            setTimeout(() => {
                                sendToOffscreen({ type: 'OFFSCREEN_START_CAPTURE', streamId })
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
                    }, 200);
                })
                    .catch((err) => sendResponse({ error: err.message }));
            });
        });
        return true;
    }
    if (message.type === 'STOP_RECORDING') {
        // Stop session and disconnect
        sendToOffscreen({ type: 'OFFSCREEN_STOP_SESSION' })
            .then(() => {
            // Disconnect WebSocket after stopping session
            return sendToOffscreen({ type: 'OFFSCREEN_DISCONNECT' });
        })
            .then((response) => {
            currentStatus = 'idle';
            sessionId = null;
            notifyPopup({ type: 'STATUS_UPDATE', status: currentStatus });
            sendResponse(response);
        })
            .catch((err) => {
            // Even if there's an error, update status
            currentStatus = 'idle';
            sessionId = null;
            notifyPopup({ type: 'STATUS_UPDATE', status: currentStatus });
            sendResponse({ error: err.message });
        });
        return true;
    }
    if (message.type === 'GET_STATUS') {
        // Verify actual WebSocket status from offscreen
        sendToOffscreen({ type: 'OFFSCREEN_GET_STATUS' })
            .then((offscreenStatus) => {
            // If WebSocket is not connected but status says connected, fix it
            if (offscreenStatus && !offscreenStatus.wsConnected && currentStatus === 'connected') {
                console.log('WebSocket not connected but status is connected, fixing...');
                currentStatus = 'idle';
                sessionId = null;
            }
            sendResponse({ status: currentStatus, sessionId });
        })
            .catch(() => {
            // If we can't reach offscreen, return current status
            // This might happen if offscreen document is not created yet
            console.log('Could not reach offscreen, returning current status:', currentStatus);
            sendResponse({ status: currentStatus, sessionId });
        });
        return true;
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
// Keep service worker alive periodically
chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keepAlive') {
        console.log('Service worker keepalive');
    }
});
console.log('Service worker ready');
//# sourceMappingURL=service-worker.js.map