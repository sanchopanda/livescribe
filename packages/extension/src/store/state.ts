import { create } from 'zustand';

type ConnectionStatus = 'idle' | 'connected' | 'recording' | 'processing' | 'error';

interface AppState {
  status: ConnectionStatus;
  sessionId: string | null;
  isRecording: boolean;
  errorMessage: string | null;

  // Actions
  setStatus: (status: ConnectionStatus) => void;
  setSessionId: (sessionId: string | null) => void;
  setRecording: (isRecording: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  status: 'idle',
  sessionId: null,
  isRecording: false,
  errorMessage: null,

  setStatus: (status) => set({ status }),
  setSessionId: (sessionId) => set({ sessionId }),
  setRecording: (isRecording) => set({ isRecording }),
  setError: (errorMessage) => set({ errorMessage, status: 'error' }),
  reset: () =>
    set({
      status: 'idle',
      sessionId: null,
      isRecording: false,
      errorMessage: null,
    }),
}));
