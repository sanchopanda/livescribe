/**
 * Audio encoding utilities
 */
/**
 * Convert Float32Array audio samples to Int16Array PCM format
 */
export declare function float32ToInt16(float32Array: Float32Array): Int16Array;
/**
 * Convert ArrayBuffer to base64 string for WebSocket transmission
 */
export declare function arrayBufferToBase64(buffer: ArrayBuffer): string;
/**
 * Convert base64 string back to ArrayBuffer
 */
export declare function base64ToArrayBuffer(base64: string): ArrayBuffer;
/**
 * Create audio chunks from a larger buffer
 */
export declare function createChunks(buffer: ArrayBuffer, chunkSize?: number): ArrayBuffer[];
//# sourceMappingURL=encoder.d.ts.map