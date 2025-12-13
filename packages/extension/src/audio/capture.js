export class AudioCapture {
    constructor() {
        this.audioContext = null;
        this.mediaStream = null;
        this.workletNode = null;
        this.isCapturing = false;
    }
    async start(options = {}) {
        if (this.isCapturing) {
            throw new Error('Already capturing');
        }
        try {
            // Request tab capture using Chrome API
            this.mediaStream = await this.requestTabCapture();
            // Create AudioContext with specified sample rate (default 16kHz for STT)
            const sampleRate = options.sampleRate || 16000;
            this.audioContext = new AudioContext({ sampleRate });
            // Load AudioWorklet processor
            await this.audioContext.audioWorklet.addModule(chrome.runtime.getURL('processor.worklet.js'));
            // Create AudioWorklet node
            this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor', {
                processorOptions: {
                    sampleRate,
                },
            });
            // Listen for audio chunks from worklet
            this.workletNode.port.onmessage = (event) => {
                if (event.data.type === 'audio-chunk' && options.onAudioChunk) {
                    options.onAudioChunk(event.data.chunk);
                }
            };
            // Connect nodes
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            source.connect(this.workletNode);
            this.workletNode.connect(this.audioContext.destination);
            this.isCapturing = true;
            console.log('Audio capture started');
        }
        catch (err) {
            console.error('Failed to start audio capture:', err);
            this.cleanup();
            throw err;
        }
    }
    async stop() {
        if (!this.isCapturing) {
            return;
        }
        this.cleanup();
        this.isCapturing = false;
        console.log('Audio capture stopped');
    }
    async requestTabCapture() {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ type: 'START_CAPTURE' }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (response.error) {
                    reject(new Error(response.error));
                    return;
                }
                // The actual stream is returned by the chrome.tabCapture API
                // We need to use a different approach
                chrome.tabCapture.capture({
                    audio: true,
                    video: false,
                }, (stream) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (!stream) {
                        reject(new Error('Failed to capture tab audio'));
                        return;
                    }
                    resolve(stream);
                });
            });
        });
    }
    cleanup() {
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach((track) => track.stop());
            this.mediaStream = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
    isActive() {
        return this.isCapturing;
    }
}
//# sourceMappingURL=capture.js.map