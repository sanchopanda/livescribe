declare let currentStatus: 'idle' | 'connected' | 'recording' | 'error';
declare let sessionId: string | null;
declare let offscreenCreated: boolean;
declare function ensureOffscreen(): Promise<void>;
declare function sendToOffscreen(message: object): Promise<any>;
declare function notifyPopup(message: object): void;
//# sourceMappingURL=service-worker.d.ts.map