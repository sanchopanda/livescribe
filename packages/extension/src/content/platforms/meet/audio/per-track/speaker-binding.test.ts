import { describe, expect, it } from 'vitest';
import { TrackSpeakerBinding } from './speaker-binding';

const SERGEY = { participantId: 'spaces/Z2eZuCUpKwIB/devices/555', speaker: 'Сергей Чумеров' };
const DANIIL = { participantId: 'spaces/Z2eZuCUpKwIB/devices/556', speaker: 'Даниил Никишкин' };
const ANNA = { participantId: 'spaces/Z2eZuCUpKwIB/devices/558', speaker: 'Анна' };
const TRACK_A = '33f1a44f-0d1e-4af0-a9c6-bba5b1d58b73';
const TRACK_B = 'd5c1572e-9cfa-43eb-ae4c-b9c23b398f88';
const LOCAL = 'a1b2c3d4-0000-4000-8000-000000000000';

/** RMS 0.09 — уровень говорящего участника из снимка живого звонка; 0.0000 — пустой слот Meet. */
const LOUD = 0.09;
const SILENT = 0;

describe('TrackSpeakerBinding', () => {
  it('связывает дорожку с участником после трёх согласных наблюдений', () => {
    const binding = new TrackSpeakerBinding();
    const observation = {
      tracks: [
        { trackId: TRACK_A, rms: LOUD },
        { trackId: TRACK_B, rms: SILENT },
      ],
      domSpeaker: SERGEY,
    };

    expect(binding.observe(observation)).toEqual([]);
    expect(binding.observe(observation)).toEqual([]);
    expect(binding.observe(observation)).toEqual([
      { trackId: TRACK_A, participantId: SERGEY.participantId, speaker: SERGEY.speaker },
    ]);
    expect(binding.speakerFor(TRACK_A)).toBe(SERGEY.speaker);
  });

  it('сообщает о привязке один раз, а не на каждом такте', () => {
    const binding = new TrackSpeakerBinding();
    const observation = { tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: SERGEY };

    binding.observe(observation);
    binding.observe(observation);
    binding.observe(observation);
    expect(binding.observe(observation)).toEqual([]);
  });

  it('не связывает, когда звучат две дорожки сразу', () => {
    // Момент перебивания: подсветка укажет одного, а дорожек с речью две — из такого наблюдения
    // нельзя понять, какая из них его. Это и есть класс дефекта LS-28, который память чинит.
    const binding = new TrackSpeakerBinding();
    const observation = {
      tracks: [
        { trackId: TRACK_A, rms: LOUD },
        { trackId: TRACK_B, rms: LOUD },
      ],
      domSpeaker: SERGEY,
    };

    binding.observe(observation);
    binding.observe(observation);
    binding.observe(observation);
    expect(binding.speakerFor(TRACK_A)).toBeNull();
  });

  it('не связывает, когда подсветка молчит или имя не прочитано', () => {
    const binding = new TrackSpeakerBinding();
    const tracks = [{ trackId: TRACK_A, rms: LOUD }];

    binding.observe({ tracks, domSpeaker: null });
    binding.observe({ tracks, domSpeaker: { participantId: SERGEY.participantId, speaker: null } });
    binding.observe({ tracks, domSpeaker: null });
    expect(binding.speakerFor(TRACK_A)).toBeNull();
  });

  it('локальная дорожка сама по себе не конкурент: молчащая — привязка остальных набирается', () => {
    // The local track is never counted as a competing speaker — only whether it is loud matters
    // (see the next test). With the local mic silent, a loud remote track still confirms normally.
    const binding = new TrackSpeakerBinding();
    const observation = {
      tracks: [
        { trackId: TRACK_A, rms: LOUD },
        { trackId: LOCAL, rms: SILENT },
      ],
      localTrackIds: [LOCAL],
      domSpeaker: SERGEY,
    };

    binding.observe(observation);
    binding.observe(observation);
    expect(binding.observe(observation)).toEqual([
      { trackId: TRACK_A, participantId: SERGEY.participantId, speaker: SERGEY.speaker },
    ]);
  });

  it('владелец записи говорит поверх Сергея: наблюдение не набирается, пока локальная дорожка громкая', () => {
    // Scenario: owner talking over Сергей. The self tile lights up whenever the recorder speaks,
    // so a loud local mic makes the tile highlight untrustworthy even though only one *remote*
    // track is above threshold — trusting it here would let the owner's speech steal the remote
    // participant's track and irreversibly relabel their stored segments as the owner.
    const binding = new TrackSpeakerBinding();
    const observation = {
      tracks: [
        { trackId: TRACK_A, rms: LOUD },
        { trackId: LOCAL, rms: LOUD },
      ],
      localTrackIds: [LOCAL],
      domSpeaker: SERGEY,
    };

    binding.observe(observation);
    binding.observe(observation);
    binding.observe(observation);
    expect(binding.speakerFor(TRACK_A)).toBeNull();
  });

  it('обнуляет счётчик согласий при несогласном наблюдении', () => {
    const binding = new TrackSpeakerBinding();
    const withSergey = { tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: SERGEY };
    const withDaniil = { tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: DANIIL };

    binding.observe(withSergey);
    binding.observe(withSergey);
    binding.observe(withDaniil);
    binding.observe(withSergey);
    expect(binding.speakerFor(TRACK_A)).toBeNull();
  });

  it('перевязывает дорожку, когда Meet отдал слот другому участнику', () => {
    // Слотов больше, чем участников (наблюдали 4 на 3), и Meet их переиспользует.
    // Три миссинга от Дани́ла дропают привязку Сергея. Потом нужны три новых согласных наблюдения.
    const binding = new TrackSpeakerBinding();
    const withSergey = { tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: SERGEY };
    const withDaniil = { tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: DANIIL };

    binding.observe(withSergey);
    binding.observe(withSergey);
    binding.observe(withSergey);
    expect(binding.speakerFor(TRACK_A)).toBe(SERGEY.speaker);

    // Three misses from Daniil drop Sergey's binding.
    binding.observe(withDaniil);
    binding.observe(withDaniil);
    expect(binding.observe(withDaniil)).toEqual([]);
    expect(binding.speakerFor(TRACK_A)).toBeNull();

    // Three new agreeing observations confirm Daniil.
    binding.observe(withDaniil);
    binding.observe(withDaniil);
    expect(binding.observe(withDaniil)).toEqual([
      { trackId: TRACK_A, participantId: DANIIL.participantId, speaker: DANIIL.speaker },
    ]);
    expect(binding.speakerFor(TRACK_A)).toBe(DANIIL.speaker);
  });

  it('не сбрасывает привязку при шуме: три наблюдения разных участников не накапливаются', () => {
    // Confirmed binding on Sergey should persist when mismatches come from different participants.
    const binding = new TrackSpeakerBinding();
    const withSergey = { tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: SERGEY };
    const withDaniil = { tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: DANIIL };
    const withAnna = { tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: ANNA };

    binding.observe(withSergey);
    binding.observe(withSergey);
    binding.observe(withSergey);
    expect(binding.speakerFor(TRACK_A)).toBe(SERGEY.speaker);

    // Mismatches from three different participants: none accumulate, Sergey stays confirmed.
    binding.observe(withDaniil);
    binding.observe(withAnna);
    binding.observe(withDaniil);

    expect(binding.speakerFor(TRACK_A)).toBe(SERGEY.speaker);
  });

  it('держит одного участника ровно на одной дорожке', () => {
    const binding = new TrackSpeakerBinding();
    const onA = { tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: SERGEY };
    const onB = { tracks: [{ trackId: TRACK_B, rms: LOUD }], domSpeaker: SERGEY };

    binding.observe(onA);
    binding.observe(onA);
    binding.observe(onA);

    binding.observe(onB);
    binding.observe(onB);
    binding.observe(onB);

    expect(binding.speakerFor(TRACK_B)).toBe(SERGEY.speaker);
    expect(binding.speakerFor(TRACK_A)).toBeNull();
  });

  it('reset забывает всё — новый звонок начинается с чистого листа', () => {
    const binding = new TrackSpeakerBinding();
    const observation = { tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: SERGEY };

    binding.observe(observation);
    binding.observe(observation);
    binding.observe(observation);
    binding.reset();

    expect(binding.speakerFor(TRACK_A)).toBeNull();
  });
});
