import { describe, expect, it } from 'vitest';
import { buildCaptionSegmentRecord, shouldOpenSttStream } from './handler.js';

const SESSION_START = 1_700_000_000_000;

function sessionWith(overrides: { meetingId?: string | undefined; startedAtMs?: number } = {}) {
  return {
    meetingId: 'meetingId' in overrides ? overrides.meetingId : 'meeting_1',
    startedAtMs: 'startedAtMs' in overrides ? overrides.startedAtMs : SESSION_START,
  } as any;
}

describe('buildCaptionSegmentRecord', () => {
  it('пишет реплику субтитров с именем участника', () => {
    const record = buildCaptionSegmentRecord(
      sessionWith(),
      { text: 'Хмм короче, никаких уведомлений об этом нет.', speaker: 'Сергей Чумеров' },
      SESSION_START + 9_000,
    );

    expect(record).toEqual({
      meetingId: 'meeting_1',
      speaker: 'Сергей Чумеров',
      text: 'Хмм короче, никаких уведомлений об этом нет.',
      tsMs: 9_000,
      confidence: null,
    });
  });

  it('оставляет confidence пустым, а не выдумывает единицу', () => {
    // Meet не сообщает уверенность распознавания. Записать 1.0 значило бы утверждать в базе
    // «распознано наверняка» про текст, который заметно грубее Deepgram.
    const record = buildCaptionSegmentRecord(
      sessionWith(),
      { text: 'Это время. сть', speaker: 'Вы' },
      SESSION_START + 1_000,
    );

    expect(record?.confidence).toBeNull();
  });

  it('допускает реплику без имени', () => {
    const record = buildCaptionSegmentRecord(
      sessionWith(),
      { text: 'кто-то говорит', speaker: null },
      SESSION_START + 2_000,
    );

    expect(record?.speaker).toBeNull();
  });

  it('отбрасывает пустой текст', () => {
    expect(
      buildCaptionSegmentRecord(sessionWith(), { text: '   ', speaker: 'Вы' }, SESSION_START),
    ).toBeNull();
  });

  it('ничего не пишет для анонимной сессии', () => {
    // Без Meeting сегмент некуда прикрепить — как и у финалов Deepgram.
    expect(
      buildCaptionSegmentRecord(
        sessionWith({ meetingId: undefined }),
        { text: 'привет', speaker: 'Вы' },
        SESSION_START,
      ),
    ).toBeNull();
  });
});

describe('shouldOpenSttStream', () => {
  it('не открывает поток распознавания для субтитров', () => {
    // Главный смысл режима: за встречу не платим. Открытый впустую стрим Deepgram
    // это и деньги, и лишний дребезг stt_status у клиента, которому он не нужен.
    expect(shouldOpenSttStream('meet-captions')).toBe(false);
  });

  it('открывает поток для аудио-режимов', () => {
    expect(shouldOpenSttStream('mixed')).toBe(true);
    expect(shouldOpenSttStream('per-track')).toBe(true);
  });

  it('открывает поток, когда источник не указан', () => {
    // Старая сборка расширения не присылает transcriptSource — прежнее поведение обязано выжить.
    expect(shouldOpenSttStream(undefined)).toBe(true);
    expect(shouldOpenSttStream(null)).toBe(true);
  });
});
