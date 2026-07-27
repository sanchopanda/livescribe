import { getOpenRouterKey, getBaseUrl } from './config.js';

export class LlmError extends Error {}

export function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

export interface ChatArgs {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function chatJson(args: ChatArgs): Promise<unknown> {
  const key = getOpenRouterKey();
  if (!key) throw new LlmError('llm_not_configured');
  const { model, system, user, maxTokens = 1024, timeoutMs = 30000 } = args;

  const doCall = async (extraSystem?: string): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${getBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: extraSystem ? `${system}\n\n${extraSystem}` : system },
            { role: 'user', content: user },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new LlmError(`openrouter_http_${res.status}`);
      const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new LlmError('openrouter_no_content');
      return parseJsonContent(content);
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await doCall();
  } catch (err) {
    if (err instanceof SyntaxError) {
      return await doCall('Ответь СТРОГО валидным JSON-объектом без markdown-обёрток.');
    }
    if (err instanceof LlmError) throw err;
    throw new LlmError((err as Error).message || 'openrouter_failed');
  }
}
