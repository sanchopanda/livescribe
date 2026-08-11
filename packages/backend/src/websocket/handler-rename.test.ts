import { describe, expect, it } from 'vitest';
import { buildParticipantRenamePlan } from './handler.js';

describe('buildParticipantRenamePlan', () => {
  it('переименовывает сегменты, записанные под технической подписью', () => {
    expect(
      buildParticipantRenamePlan({
        meetingId: 'meeting_1',
        previousSpeaker: 'Participant 33f1a44f',
        nextSpeaker: 'Сергей Чумеров',
      }),
    ).toEqual({
      meetingId: 'meeting_1',
      previousSpeaker: 'Participant 33f1a44f',
      nextSpeaker: 'Сергей Чумеров',
    });
  });

  it('ничего не делает без встречи — анонимная сессия в базу не пишет', () => {
    expect(
      buildParticipantRenamePlan({
        meetingId: null,
        previousSpeaker: 'Participant 33f1a44f',
        nextSpeaker: 'Сергей Чумеров',
      }),
    ).toBeNull();
  });

  it('ничего не делает, когда прежняя подпись неизвестна', () => {
    // Без прежней подписи невозможно выбрать сегменты: колонки participantId в схеме нет.
    expect(
      buildParticipantRenamePlan({
        meetingId: 'meeting_1',
        previousSpeaker: undefined,
        nextSpeaker: 'Сергей Чумеров',
      }),
    ).toBeNull();
  });

  it('ничего не делает, когда имя не изменилось', () => {
    expect(
      buildParticipantRenamePlan({
        meetingId: 'meeting_1',
        previousSpeaker: 'Сергей Чумеров',
        nextSpeaker: 'Сергей Чумеров',
      }),
    ).toBeNull();
  });

  it('ничего не делает на пустом имени', () => {
    expect(
      buildParticipantRenamePlan({
        meetingId: 'meeting_1',
        previousSpeaker: 'Participant 33f1a44f',
        nextSpeaker: '   ',
      }),
    ).toBeNull();
  });
});
