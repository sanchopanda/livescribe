"use strict";
// AudioWorkletProcessor for processing audio in real-time
// This runs in the AudioWorklet scope (separate from main thread)
// @ts-ignore - AudioWorklet global types
class AudioProcessor extends AudioWorkletProcessor {
    constructor(_options) {
        super();
        this.bufferSize = 4096;
        this.bufferIndex = 0;
        this.buffer = new Float32Array(this.bufferSize);
    }
    process(inputs, _outputs, _parameters) {
        const input = inputs[0];
        if (!input || !input[0]) {
            return true;
        }
        const inputChannel = input[0];
        for (let i = 0; i < inputChannel.length; i++) {
            this.buffer[this.bufferIndex++] = inputChannel[i];
            // When buffer is full, convert to Int16 and send to main thread
            if (this.bufferIndex >= this.bufferSize) {
                const int16Buffer = this.float32ToInt16(this.buffer);
                // @ts-ignore - port is available in AudioWorkletProcessor
                this.port.postMessage({
                    type: 'audio-chunk',
                    chunk: int16Buffer.buffer,
                });
                this.bufferIndex = 0;
            }
        }
        return true;
    }
    float32ToInt16(float32Array) {
        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            // Clamp to [-1, 1] range
            const clamped = Math.max(-1, Math.min(1, float32Array[i]));
            // Convert to 16-bit integer
            int16Array[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        }
        return int16Array;
    }
}
// @ts-ignore - AudioWorklet global API
registerProcessor('audio-processor', AudioProcessor);
//# sourceMappingURL=processor.worklet.js.map