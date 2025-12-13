const WS_URL = 'ws://localhost:3001/ws';
export class WebSocketClient {
    constructor(onStatusChange, onMessage) {
        this.onStatusChange = onStatusChange;
        this.onMessage = onMessage;
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
    }
    connect() {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(WS_URL);
                this.ws.onopen = () => {
                    console.log('WebSocket connected');
                    this.reconnectAttempts = 0;
                    this.onStatusChange('connected');
                    resolve();
                };
                this.ws.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        console.log('Received message:', message);
                        this.onMessage(message);
                    }
                    catch (err) {
                        console.error('Failed to parse WebSocket message:', err);
                    }
                };
                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    this.onStatusChange('error');
                    reject(error);
                };
                this.ws.onclose = () => {
                    console.log('WebSocket closed');
                    this.onStatusChange('disconnected');
                    this.attemptReconnect();
                };
            }
            catch (err) {
                reject(err);
            }
        });
    }
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
    sendMessage(message) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.error('WebSocket is not connected');
            return;
        }
        this.ws.send(JSON.stringify(message));
    }
    sendAudioChunk(sessionId, chunk) {
        // Convert ArrayBuffer to base64
        const bytes = new Uint8Array(chunk);
        const binary = bytes.reduce((acc, byte) => acc + String.fromCharCode(byte), '');
        const base64 = btoa(binary);
        this.sendMessage({
            type: 'audio',
            sessionId,
            sampleRate: 16000,
            channels: 1,
            chunk: base64,
        });
    }
    startSession(language = 'ru-RU') {
        this.sendMessage({
            type: 'start',
            language,
        });
    }
    stopSession(sessionId) {
        this.sendMessage({
            type: 'stop',
            sessionId,
        });
    }
    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnect attempts reached');
            return;
        }
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * this.reconnectAttempts;
        console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})...`);
        setTimeout(() => {
            this.connect().catch((err) => {
                console.error('Reconnection failed:', err);
            });
        }, delay);
    }
    isConnected() {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
}
//# sourceMappingURL=client.js.map