import { describe, expect, it } from 'vitest';
import { buildParticipantRenamePlan } from './handler.js';

describe('buildParticipantRenamePlan', () => {
  it('переименовывает сегменты, записанные под технической подписью', () => {
    expect(
      buildParticipantRenamePlan({
        meetingId: 'meeting_1',
        previousSpeaker: 'Participant 33f1a44f',
        nextSpeaker: 'Сергей Чумеров',
        placeholderSpeaker: 'Participant 33f1a44f',
      }),
    ).toEqual({
      meetingId: 'meeting_1',
      previousSpeaker: 'Participant 33f1a44f',
      nextSpeaker: 'Сергей Чумеров',
    });
  });

  it('на анонимной сессии всё равно возвращает план с meetingId: null — виджету нужно переименовать реплики на экране, просто без записи в базу', () => {
    expect(
      buildParticipantRenamePlan({
        meetingId: null,
        previousSpeaker: 'Participant 33f1a44f',
        nextSpeaker: 'Сергей Чумеров',
        placeholderSpeaker: 'Participant 33f1a44f',
      }),
    ).toEqual({
      meetingId: null,
      previousSpeaker: 'Participant 33f1a44f',
      nextSpeaker: 'Сергей Чумеров',
    });
  });

  it('ничего не делает, когда прежняя подпись неизвестна', () => {
    // Без прежней подписи невозможно выбрать сегменты: колонки participantId в схеме нет.
    expect(
      buildParticipantRenamePlan({
        meetingId: 'meeting_1',
        previousSpeaker: undefined,
        nextSpeaker: 'Сергей Чумеров',
        placeholderSpeaker: 'Participant 33f1a44f',
      }),
    ).toBeNull();
  });

  it('ничего не делает, когда имя не изменилось', () => {
    expect(
      buildParticipantRenamePlan({
        meetingId: 'meeting_1',
        previousSpeaker: 'Сергей Чумеров',
        nextSpeaker: 'Сергей Чумеров',
        placeholderSpeaker: 'Participant 33f1a44f',
      }),
    ).toBeNull();
  });

  it('ничего не делает на пустом имени', () => {
    expect(
      buildParticipantRenamePlan({
        meetingId: 'meeting_1',
        previousSpeaker: 'Participant 33f1a44f',
        nextSpeaker: '   ',
        placeholderSpeaker: 'Participant 33f1a44f',
      }),
    ).toBeNull();
  });

  it('не трогает сохранённые сегменты, если прежняя подпись — настоящее имя, а не техническая заглушка', () => {
    // Meet передал слот дорожки другому участнику: прежняя подпись 'Иван Иванов' принадлежит
    // реальному человеку. Если применить bulk-переименование по этой подписи, оно затронет и его
    // настоящие реплики — переименовать их в "Мария Петрова" значило бы уничтожить верную атрибуцию.
    expect(
      buildParticipantRenamePlan({
        meetingId: 'meeting_1',
        previousSpeaker: 'Иван Иванов',
        nextSpeaker: 'Мария Петрова',
        placeholderSpeaker: 'Participant 33f1a44f',
      }),
    ).toBeNull();
  });

  it('сравнивает подпись-заглушку с обрезкой пробелов по краям', () => {
    expect(
      buildParticipantRenamePlan({
        meetingId: 'meeting_1',
        previousSpeaker: '  Participant 33f1a44f  ',
        nextSpeaker: 'Сергей Чумеров',
        placeholderSpeaker: 'Participant 33f1a44f',
      }),
    ).toEqual({
      meetingId: 'meeting_1',
      previousSpeaker: 'Participant 33f1a44f',
      nextSpeaker: 'Сергей Чумеров',
    });
  });
});
