import { describe, it, expect } from 'vitest';
import { classifyFrame } from './nemotron.js';

describe('classifyFrame', () => {
  it('пустой delta-кадр — "event", а не "unknown" (регресс: раньше ложно предупреждал о смене схемы)', () => {
    // Пустой partial — штатное дело потокового ASR (например самое начало сегмента), тип при
    // этом полностью опознан и обрабатывается — предупреждения быть не должно.
    const frame = { type: 'conversation.item.input_audio_transcription.delta', delta: '' };
    expect(classifyFrame(frame)).toBe('event');
  });

  it('пустой completed-кадр — тоже "event"', () => {
    const frame = { type: 'conversation.item.input_audio_transcription.completed', transcript: '   ' };
    expect(classifyFrame(frame)).toBe('event');
  });

  it('непустой delta-кадр — "event"', () => {
    const frame = { type: 'conversation.item.input_audio_transcription.delta', delta: 'привет' };
    expect(classifyFrame(frame)).toBe('event');
  });

  it('session.created — "known-empty" (служебный кадр, ожидаемо без текста)', () => {
    expect(classifyFrame({ type: 'session.created' })).toBe('known-empty');
  });

  it('кадр с type, содержащим error — "error"', () => {
    expect(classifyFrame({ type: 'error', error: { message: 'bad request' } })).toBe('error');
  });

  it('кадр с type, содержащим failed — "error"', () => {
    expect(classifyFrame({ type: 'response.failed' })).toBe('error');
  });

  it('выдуманный/незнакомый тип — "unknown" (действительно повод для warning)', () => {
    expect(classifyFrame({ type: 'something.completely.new' })).toBe('unknown');
  });

  it('кадр без поля type — "unknown"', () => {
    expect(classifyFrame({})).toBe('unknown');
  });
});
