declare class AudioProcessor extends AudioWorkletProcessor {
    private bufferSize;
    private buffer;
    private bufferIndex;
    constructor(_options?: any);
    process(inputs: Float32Array[][], _outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean;
    private float32ToInt16;
}
//# sourceMappingURL=processor.worklet.d.ts.map