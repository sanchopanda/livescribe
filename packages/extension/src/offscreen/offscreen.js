// Offscreen document for WebSocket and Audio Capture
// This runs persistently and maintains connections
console.log('LiveScribe offscreen document initialized');
const WS_URL = 'ws://localhost:3001/ws';
// State
let ws = null;
let sessionId = null;
let audioContext = null;
let mediaStream = null;
let workletNode = null;
let sourceNode = null;
// Connect to WebSocket
function connect() {
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
            notifyServiceWorker({ type: 'WS_STATUS', status: 'connected' });
            if (!resolved) {
                resolved = true;
                resolve();
            }
        };
        newWs.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log('Received from server:', message);
                if (message.type === 'status' && message.sessionId) {
                    sessionId = message.sessionId;
                }
                notifyServiceWorker({ type: 'WS_MESSAGE', message });
            }
            catch (err) {
                console.error('Failed to parse message:', err);
            }
        };
        newWs.onerror = (error) => {
            console.error('WebSocket error:', error);
            // Don't reject immediately - wait for onclose
            // The error event doesn't provide much info, onclose will tell us more
        };
        newWs.onclose = (event) => {
            console.log('WebSocket closed', event.code, event.reason);
            // If connection failed during connect attempt, reject the promise
            if (!resolved && !rejected) {
                rejected = true;
                // Only reject if it's a connection error (not normal closure)
                if (event.code !== 1000) {
                    reject(new Error(`Connection failed: ${event.reason || `code ${event.code}`}`));
                }
                else {
                    reject(new Error('Connection closed'));
                }
            }
            // Stop capture if it was running
            if (workletNode) {
                stopCapture();
            }
            // Notify service worker about disconnection
            if (ws === newWs) {
                notifyServiceWorker({ type: 'WS_STATUS', status: 'disconnected' });
                ws = null;
            }
            // No automatic reconnection - user will click "Start Recording" to reconnect
        };
    });
}
// Disconnect WebSocket
function disconnect() {
    if (ws) {
        ws.close();
        ws = null;
    }
    stopCapture();
}
// Send message to WebSocket
function sendMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}
// Start audio capture
async function startCapture(streamIdOrStream) {
    try {
        // Stop any existing capture first
        if (workletNode || mediaStream || audioContext) {
            console.log('Stopping existing capture before starting new one');
            stopCapture();
            // Wait a bit for cleanup to complete
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        let stream;
        // If we received a streamId (string), use getUserMedia with it
        // This is the fastest approach when streamId is obtained in popup
        if (typeof streamIdOrStream === 'string') {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    mandatory: {
                        chromeMediaSource: 'tab',
                        chromeMediaSourceId: streamIdOrStream,
                    },
                },
                video: false,
            });
        }
        else if (streamIdOrStream instanceof MediaStream) {
            // Use provided stream directly (for backward compatibility)
            stream = streamIdOrStream;
        }
        else {
            throw new Error('No stream ID or media stream provided');
        }
        await processStream(stream);
    }
    catch (err) {
        console.error('Failed to start capture:', err);
        notifyServiceWorker({ type: 'CAPTURE_STATUS', status: 'error', error: err.message });
        throw err;
    }
}
// Process the media stream
async function processStream(stream) {
    // Check if stream has audio
    if (stream.getAudioTracks().length === 0) {
        throw new Error('No audio tracks found in stream');
    }
    mediaStream = stream;
    // Create audio context
    audioContext = new AudioContext({ sampleRate: 16000 });
    // Load worklet
    await audioContext.audioWorklet.addModule(chrome.runtime.getURL('processor.worklet.js'));
    // Create nodes
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
    // Handle audio chunks
    workletNode.port.onmessage = (event) => {
        if (event.data.type === 'audio-chunk' && sessionId && ws) {
            const chunk = event.data.chunk;
            const base64 = arrayBufferToBase64(chunk);
            sendMessage({
                type: 'audio',
                sessionId,
                sampleRate: 16000,
                channels: 1,
                chunk: base64,
            });
        }
    };
    // Connect nodes
    sourceNode.connect(workletNode);
    workletNode.connect(audioContext.destination);
    console.log('Audio capture started');
    notifyServiceWorker({ type: 'CAPTURE_STATUS', status: 'recording' });
}
// Stop audio capture
function stopCapture() {
    // Disconnect worklet node first
    if (workletNode) {
        try {
            workletNode.port.onmessage = null;
            workletNode.disconnect();
        }
        catch (err) {
            console.warn('Error disconnecting worklet node:', err);
        }
        workletNode = null;
    }
    // Disconnect source node
    if (sourceNode) {
        try {
            sourceNode.disconnect();
        }
        catch (err) {
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
        }
        catch (err) {
            console.warn('Error stopping media stream tracks:', err);
        }
        mediaStream = null;
    }
    // Close audio context
    if (audioContext) {
        try {
            audioContext.close();
        }
        catch (err) {
            console.warn('Error closing audio context:', err);
        }
        audioContext = null;
    }
    console.log('Audio capture stopped');
    notifyServiceWorker({ type: 'CAPTURE_STATUS', status: 'stopped' });
}
// Helper: ArrayBuffer to base64
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
// Notify service worker
function notifyServiceWorker(message) {
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
            disconnect();
            sendResponse({ success: true });
            return true;
        case 'OFFSCREEN_START_SESSION':
            // Check if WebSocket is connected
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                sendResponse({ error: 'WebSocket is not connected. Please connect first.' });
                return true;
            }
            sendMessage({ type: 'start', language: message.language || 'ru-RU' });
            sendResponse({ success: true });
            return true;
        case 'OFFSCREEN_STOP_SESSION':
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
export {};
//# sourceMappingURL=offscreen.js.map