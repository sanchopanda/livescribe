export interface CaptureOptions {
    sampleRate?: number;
    onAudioChunk?: (chunk: ArrayBuffer) => void;
}
export declare class AudioCapture {
    private audioContext;
    private mediaStream;
    private workletNode;
    private isCapturing;
    start(options?: CaptureOptions): Promise<void>;
    stop(): Promise<void>;
    private requestTabCapture;
    private cleanup;
    isActive(): boolean;
}
//# sourceMappingURL=capture.d.ts.map