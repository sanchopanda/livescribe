/**
 * Audio encoding utilities
 */
/**
 * Convert Float32Array audio samples to Int16Array PCM format
 */
export function float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        // Clamp to [-1, 1] range
        const clamped = Math.max(-1, Math.min(1, float32Array[i]));
        // Convert to 16-bit integer
        int16Array[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
    return int16Array;
}
/**
 * Convert ArrayBuffer to base64 string for WebSocket transmission
 */
export function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
/**
 * Convert base64 string back to ArrayBuffer
 */
export function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}
/**
 * Create audio chunks from a larger buffer
 */
export function createChunks(buffer, chunkSize = 4096) {
    const chunks = [];
    const totalLength = buffer.byteLength;
    for (let offset = 0; offset < totalLength; offset += chunkSize) {
        const length = Math.min(chunkSize, totalLength - offset);
        const chunk = buffer.slice(offset, offset + length);
        chunks.push(chunk);
    }
    return chunks;
}
//# sourceMappingURL=encoder.js.map