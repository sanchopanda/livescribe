import { create } from 'zustand';
export const useAppStore = create((set) => ({
    status: 'idle',
    sessionId: null,
    isRecording: false,
    errorMessage: null,
    setStatus: (status) => set({ status }),
    setSessionId: (sessionId) => set({ sessionId }),
    setRecording: (isRecording) => set({ isRecording }),
    setError: (errorMessage) => set({ errorMessage, status: 'error' }),
    reset: () => set({
        status: 'idle',
        sessionId: null,
        isRecording: false,
        errorMessage: null,
    }),
}));
//# sourceMappingURL=state.js.map