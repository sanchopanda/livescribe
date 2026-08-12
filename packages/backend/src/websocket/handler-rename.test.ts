import { describe, expect, it } from 'vitest';
import { buildParticipantRenamePlan } from './handler.js';

describe('buildParticipantRenamePlan', () => {
  it('переименовывает сегменты, записанные под технической подписью', () => {
    expect(
      buildParticipantRenamePlan({
        meetingId: 'meeting_1',
        placeholderSpeaker: 'Participant 33f1a44f',
        nextSpeaker: 'Сергей Чумеров',
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
        placeholderSpeaker: 'Participant 33f1a44f',
        nextSpeaker: 'Сергей Чумеров',
      }),
    ).toEqual({
      meetingId: null,
      previousSpeaker: 'Participant 33f1a44f',
      nextSpeaker: 'Сергей Чумеров',
    });
  });

  it('ничего не делает, когда имя совпадает с заглушкой', () => {
    expect(
      buildParticipantRenamePlan({
        meetingId: 'meeting_1',
        placeholderSpeaker: 'Participant 33f1a44f',
        nextSpeaker: 'Participant 33f1a44f',
      }),
    ).toBeNull();
  });

  it('ничего не делает на пустом имени', () => {
    expect(
      buildParticipantRenamePlan({
        meetingId: 'meeting_1',
        placeholderSpeaker: 'Participant 33f1a44f',
        nextSpeaker: '   ',
      }),
    ).toBeNull();
  });

  it('selector — всегда заглушка, а не текущая подпись участника: порядок сообщений не важен', () => {
    // A chunk carrying the confirmed name can arrive before the rename_participant message that
    // announces it, so by the time the plan is built the in-memory label may already read as a
    // real name. The guarantee this pins: previousSpeaker in the plan is always the deterministic
    // placeholder, never whatever label happens to be held in memory — so the backfill's
    // correctness cannot depend on which message won the race.
    const plan = buildParticipantRenamePlan({
      meetingId: 'meeting_1',
      placeholderSpeaker: 'Participant 33f1a44f',
      nextSpeaker: 'Мария Петрова',
    });

    expect(plan?.previousSpeaker).toBe('Participant 33f1a44f');
  });

  it('второе переименование той же дорожки (Meet отдал слот другому участнику) тоже строит план с плейсхолдером-селектором', () => {
    // Idempotent by construction: once the first rename has run, no stored row still carries the
    // placeholder, so re-issuing the same UPDATE on a later rename of the same track matches zero
    // rows — it never touches the real name left behind by the previous occupant.
    const plan = buildParticipantRenamePlan({
      meetingId: 'meeting_1',
      placeholderSpeaker: 'Participant 33f1a44f',
      nextSpeaker: 'Мария Петрова',
    });

    expect(plan).toEqual({
      meetingId: 'meeting_1',
      previousSpeaker: 'Participant 33f1a44f',
      nextSpeaker: 'Мария Петрова',
    });
  });

  it('сравнивает подпись-заглушку с обрезкой пробелов по краям', () => {
    expect(
      buildParticipantRenamePlan({
        meetingId: 'meeting_1',
        placeholderSpeaker: '  Participant 33f1a44f  ',
        nextSpeaker: 'Сергей Чумеров',
      }),
    ).toEqual({
      meetingId: 'meeting_1',
      previousSpeaker: 'Participant 33f1a44f',
      nextSpeaker: 'Сергей Чумеров',
    });
  });
});
