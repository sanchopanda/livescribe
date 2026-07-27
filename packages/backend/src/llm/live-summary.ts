import { chatJson, type ChatArgs } from './openrouter.js';
import { getLiveModel } from './config.js';

export function coerceBullets(raw: unknown): string[] {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const arr = Array.isArray(obj.bullets) ? obj.bullets : [];
  return arr
    .filter((b): b is string => typeof b === 'string')
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .slice(0, 6);
}

const SYSTEM = [
  'Ты кратко резюмируешь идущую деловую встречу по её расшифровке.',
  'Верни JSON-объект { "bullets": [строки] } — от 3 до 6 очень коротких тезисов:',
  'о чём говорят и какие договорённости/решения уже прозвучали.',
  'Пиши на языке расшифровки. Каждый тезис — одна короткая фраза.',
].join(' ');

export async function summarizeLive(
  transcript: string,
  deps: { chat?: (args: ChatArgs) => Promise<unknown> } = {}
): Promise<{ bullets: string[] }> {
  const chat = deps.chat ?? chatJson;
  const raw = await chat({
    model: getLiveModel(),
    system: SYSTEM,
    user: `Расшифровка (возможно, неполная — встреча идёт):\n\n${transcript}`,
    maxTokens: 400,
    timeoutMs: 15000,
  });
  return { bullets: coerceBullets(raw) };
}
