import { describe, it, expect, afterEach, vi } from 'vitest';
import { parseJsonContent, chatJson, LlmError } from './openrouter.js';

describe('parseJsonContent', () => {
  it('parses plain JSON', () => {
    expect(parseJsonContent('{"a":1}')).toEqual({ a: 1 });
  });
  it('parses fenced ```json blocks', () => {
    expect(parseJsonContent('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });
  it('throws SyntaxError on garbage', () => {
    expect(() => parseJsonContent('not json')).toThrow(SyntaxError);
  });
});

describe('chatJson retry/normalization', () => {
  const originalKey = process.env.OPENROUTER_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  });

  function mockResponse(content: string): Response {
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    } as unknown as Response;
  }

  it('rejects with LlmError (not a bare SyntaxError) when both attempts return non-JSON content', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue(mockResponse('not json'));
    vi.stubGlobal('fetch', fetchMock);

    let caught: unknown;
    try {
      await chatJson({ model: 'm', system: 's', user: 'u' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(LlmError);
    expect(caught).not.toBeInstanceOf(SyntaxError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resolves to the parsed object when the response is valid JSON', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue(mockResponse('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await chatJson({ model: 'm', system: 's', user: 'u' });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
