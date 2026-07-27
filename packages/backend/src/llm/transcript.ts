export interface TranscriptSeg {
  speaker: string | null;
  text: string;
}

const MAX_CHARS = 24000;

export function buildTranscriptText(segments: TranscriptSeg[]): string {
  const lines: string[] = [];
  let total = 0;
  let truncated = false;
  for (const s of segments) {
    const text = s.text?.trim();
    if (!text) continue;
    const line = `${s.speaker?.trim() || 'Спикер'}: ${text}`;
    if (total + line.length + 1 > MAX_CHARS) {
      truncated = true;
      break;
    }
    lines.push(line);
    total += line.length + 1;
  }
  let out = lines.join('\n');
  if (truncated) out += '\n[транскрипт усечён]';
  return out;
}
