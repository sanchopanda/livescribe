type ConnectionStatus = 'idle' | 'connected' | 'recording' | 'processing' | 'error';
interface AppState {
    status: ConnectionStatus;
    sessionId: string | null;
    isRecording: boolean;
    errorMessage: string | null;
    setStatus: (status: ConnectionStatus) => void;
    setSessionId: (sessionId: string | null) => void;
    setRecording: (isRecording: boolean) => void;
    setError: (error: string | null) => void;
    reset: () => void;
}
export declare const useAppStore: import("zustand").UseBoundStore<import("zustand").StoreApi<AppState>>;
export {};
//# sourceMappingURL=state.d.ts.map