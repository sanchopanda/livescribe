export interface ChunkSignalMetrics {
  rms: number;
  peak: number;
}

export function analyzeChunkSignal(chunk: ArrayBuffer): ChunkSignalMetrics {
  const samples = new Int16Array(chunk);
  if (samples.length === 0) {
    return { rms: 0, peak: 0 };
  }

  let sumSquares = 0;
  let peak = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const normalized = samples[index] / 32768;
    const absValue = Math.abs(normalized);
    if (absValue > peak) {
      peak = absValue;
    }
    sumSquares += normalized * normalized;
  }

  return {
    rms: Math.sqrt(sumSquares / samples.length),
    peak,
  };
}

