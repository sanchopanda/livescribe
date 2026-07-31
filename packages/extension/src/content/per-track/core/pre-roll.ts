// Pre-roll buffer for per-track capture.
//
// While the VAD gate is closed the audio is not thrown away — it is kept in a small per-track
// ring buffer and flushed to the STT the moment the gate opens, so the first word of a phrase
// is not clipped. Shared by every platform's track transcriber: keeping the window in one
// place is what stops meet/ and pachca/ from drifting apart.

export const PRE_ROLL_MS = 1500;
export const PRE_ROLL_SAMPLE_RATE = 16000;
export const PRE_ROLL_CHANNELS = 1;
export const PRE_ROLL_BYTES_PER_SAMPLE = 2;

export const PRE_ROLL_MAX_BYTES =
  PRE_ROLL_SAMPLE_RATE * PRE_ROLL_CHANNELS * PRE_ROLL_BYTES_PER_SAMPLE * (PRE_ROLL_MS / 1000);

export interface BufferedTrackChunk {
  chunk: ArrayBuffer;
  byteLength: number;
}

export class PreRollBuffer {
  private chunksByTrackId = new Map<string, BufferedTrackChunk[]>();
  private bytesByTrackId = new Map<string, number>();

  constructor(private readonly maxBytes: number = PRE_ROLL_MAX_BYTES) {}

  /** Buffer a chunk, dropping the oldest ones once the window is full. */
  push(trackId: string, chunk: ArrayBuffer): void {
    // The caller reuses its buffers, so keep a copy rather than a reference.
    const cloned = chunk.slice(0);
    const chunks = this.chunksByTrackId.get(trackId) ?? [];
    chunks.push({ chunk: cloned, byteLength: cloned.byteLength });
    this.chunksByTrackId.set(trackId, chunks);

    let totalBytes = (this.bytesByTrackId.get(trackId) ?? 0) + cloned.byteLength;
    // Never trim below one chunk: a chunk larger than the whole window would otherwise be
    // dropped and the pre-roll would flush nothing at all.
    while (chunks.length > 1 && totalBytes > this.maxBytes) {
      const removed = chunks.shift();
      if (!removed) break;
      totalBytes -= removed.byteLength;
    }

    this.bytesByTrackId.set(trackId, Math.max(0, totalBytes));
  }

  /** Take everything buffered for a track and reset it — used when the gate opens. */
  consume(trackId: string): BufferedTrackChunk[] {
    const chunks = this.chunksByTrackId.get(trackId) ?? [];
    this.drop(trackId);
    return chunks;
  }

  /** Forget a track (participant left, track ended). */
  drop(trackId: string): void {
    this.chunksByTrackId.delete(trackId);
    this.bytesByTrackId.delete(trackId);
  }

  clear(): void {
    this.chunksByTrackId.clear();
    this.bytesByTrackId.clear();
  }

  bufferedBytes(trackId: string): number {
    return this.bytesByTrackId.get(trackId) ?? 0;
  }
}
