import { create } from 'zustand';

type ConnectionStatus = 'idle' | 'connected' | 'recording' | 'processing' | 'error';

interface TranscriptItem {
  text: string;
  isFinal: boolean;
  timestamp: number;
}

interface AppState {
  status: ConnectionStatus;
  sessionId: string | null;
  isRecording: boolean;
  errorMessage: string | null;
  transcripts: TranscriptItem[];

  // Actions
  setStatus: (status: ConnectionStatus) => void;
  setSessionId: (sessionId: string | null) => void;
  setRecording: (isRecording: boolean) => void;
  setError: (error: string | null) => void;
  addTranscript: (text: string, isFinal: boolean) => void;
  clearTranscripts: () => void;
  reset: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  status: 'idle',
  sessionId: null,
  isRecording: false,
  errorMessage: null,
  transcripts: [],

  setStatus: (status) => set({ status }),
  setSessionId: (sessionId) => set({ sessionId }),
  setRecording: (isRecording) => set({ isRecording }),
  setError: (errorMessage) => set({ errorMessage, status: 'error' }),
  addTranscript: (text, isFinal) =>
    set((state) => {
      if (isFinal) {
        return {
          transcripts: [...state.transcripts, { text, isFinal, timestamp: Date.now() }],
        };
      } else {
        // Update last partial transcript or add new one
        const transcripts = [...state.transcripts];
        if (transcripts.length > 0 && !transcripts[transcripts.length - 1].isFinal) {
          transcripts[transcripts.length - 1] = { text, isFinal: false, timestamp: Date.now() };
        } else {
          transcripts.push({ text, isFinal: false, timestamp: Date.now() });
        }
        return { transcripts };
      }
    }),
  clearTranscripts: () => set({ transcripts: [] }),
  reset: () =>
    set({
      status: 'idle',
      sessionId: null,
      isRecording: false,
      errorMessage: null,
      transcripts: [],
    }),
}));
