import { chatJson, type ChatArgs } from './openrouter.js';
import { getDetailedModel } from './config.js';
import { buildTranscriptText, type TranscriptSeg } from './transcript.js';
import type { ActionItem } from '@skribo/shared';

export interface MeetingAnalysis { summary: string; actionItems: ActionItem[]; }

const SYSTEM = [
  'Ты — ассистент, который анализирует расшифровку деловой встречи.',
  'Верни JSON-объект с полями: "summary" (строка, 1 краткий абзац сути встречи) и',
  '"actionItems" (массив объектов {"text": строка, "owner"?: строка} — конкретные задачи/договорённости).',
  'Пиши на языке расшифровки (русский или английский). Если задач нет — пустой массив.',
].join(' ');

export function coerceAnalysis(raw: unknown): MeetingAnalysis {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const summary = typeof obj.summary === 'string' ? obj.summary : '';
  const itemsRaw = Array.isArray(obj.actionItems) ? obj.actionItems : [];
  const actionItems = itemsRaw
    .map((it): ActionItem | null => {
      if (typeof it === 'string') return it.trim() ? { text: it.trim() } : null;
      if (it && typeof it === 'object') {
        const text = typeof (it as Record<string, unknown>).text === 'string' ? ((it as Record<string, unknown>).text as string).trim() : '';
        const ownerRaw = (it as Record<string, unknown>).owner;
        const owner = typeof ownerRaw === 'string' && ownerRaw.trim() ? ownerRaw.trim() : undefined;
        return text ? { text, ...(owner ? { owner } : {}) } : null;
      }
      return null;
    })
    .filter((x): x is ActionItem => x !== null);
  return { summary, actionItems };
}

export async function analyzeMeeting(
  segments: TranscriptSeg[],
  deps: { chat?: (args: ChatArgs) => Promise<unknown> } = {}
): Promise<MeetingAnalysis> {
  const chat = deps.chat ?? chatJson;
  const transcript = buildTranscriptText(segments);
  const raw = await chat({
    model: getDetailedModel(),
    system: SYSTEM,
    user: `Расшифровка встречи:\n\n${transcript}`,
    maxTokens: 1500,
  });
  return coerceAnalysis(raw);
}
