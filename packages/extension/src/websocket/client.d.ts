import type { ClientMessage, ServerMessage } from '@livescribe/shared';
export declare class WebSocketClient {
    private onStatusChange;
    private onMessage;
    private ws;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private reconnectDelay;
    constructor(onStatusChange: (status: 'connected' | 'disconnected' | 'error') => void, onMessage: (message: ServerMessage) => void);
    connect(): Promise<void>;
    disconnect(): void;
    sendMessage(message: ClientMessage): void;
    sendAudioChunk(sessionId: string, chunk: ArrayBuffer): void;
    startSession(language?: 'ru-RU' | 'en-US'): void;
    stopSession(sessionId: string): void;
    private attemptReconnect;
    isConnected(): boolean;
}
//# sourceMappingURL=client.d.ts.map