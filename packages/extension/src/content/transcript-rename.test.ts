import { describe, expect, it } from 'vitest';
import { renameReplicaSpeaker } from './transcript-rename';

describe('renameReplicaSpeaker', () => {
  it('переименовывает реплики прежней подписи', () => {
    const replicas = [
      { speaker: 'Participant 33f1a44f', text: 'мне нужно найти Ubisoft' },
      { speaker: 'Вы', text: 'скажи что-нибудь' },
      { speaker: 'Participant 33f1a44f', text: 'логин свой' },
    ];

    expect(renameReplicaSpeaker(replicas, 'Participant 33f1a44f', 'Сергей Чумеров')).toEqual([
      { speaker: 'Сергей Чумеров', text: 'мне нужно найти Ubisoft' },
      { speaker: 'Вы', text: 'скажи что-нибудь' },
      { speaker: 'Сергей Чумеров', text: 'логин свой' },
    ]);
  });

  it('сохраняет остальные поля реплики', () => {
    const replicas = [{ speaker: 'Participant 33f1a44f', text: 'алло', highlighted: true }];

    expect(renameReplicaSpeaker(replicas, 'Participant 33f1a44f', 'Сергей Чумеров')).toEqual([
      { speaker: 'Сергей Чумеров', text: 'алло', highlighted: true },
    ]);
  });

  it('возвращает тот же массив, когда переименовывать нечего', () => {
    const replicas = [{ speaker: 'Вы', text: 'алло' }];
    expect(renameReplicaSpeaker(replicas, 'Participant 33f1a44f', 'Сергей')).toBe(replicas);
  });

  it('ничего не делает на пустых подписях', () => {
    const replicas = [{ speaker: 'Participant 33f1a44f', text: 'алло' }];
    expect(renameReplicaSpeaker(replicas, '', 'Сергей')).toBe(replicas);
    expect(renameReplicaSpeaker(replicas, 'Participant 33f1a44f', '  ')).toBe(replicas);
  });
});
