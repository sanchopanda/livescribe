import { describe, it, expect } from 'vitest';
import { parseJsonContent } from './openrouter.js';

describe('parseJsonContent', () => {
  it('parses plain JSON', () => {
    expect(parseJsonContent('{"a":1}')).toEqual({ a: 1 });
  });
  it('parses fenced ```json blocks', () => {
    expect(parseJsonContent('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });
  it('throws SyntaxError on garbage', () => {
    expect(() => parseJsonContent('not json')).toThrow();
  });
});
