import { describe, expect, it } from 'vitest';
import { parseMeetSpeakerName, pickActiveIndicatorIndex } from './active-speaker-dom';

// Class lists captured from a live 3-person Meet call on 2026-08-11, while Сергей was talking.
// The self tile is the one that used to be picked: it carries a permanent extra class.
const DANIIL_IDLE = 'IisKdb GF8M7d gjg47c YFyDbd eQJ1qd VeFZv'.split(' ');
const SERGEY_SPEAKING = 'IisKdb GF8M7d Oaajhc YFyDbd eQJ1qd VeFZv'.split(' ');
const SERGEY_SPEAKING_LOUDER = 'IisKdb GF8M7d HX2H7 YFyDbd eQJ1qd VeFZv'.split(' ');
const SELF_IDLE = 'IisKdb GF8M7d gjg47c KUNJSe YFyDbd eQJ1qd VeFZv'.split(' ');

describe('pickActiveIndicatorIndex', () => {
  it('picks the participant whose indicator lost the idle class', () => {
    expect(pickActiveIndicatorIndex([DANIIL_IDLE, SERGEY_SPEAKING, SELF_IDLE])).toBe(1);
  });

  it('follows the speaker across level classes', () => {
    // Meet swaps the state class for a different one as the level changes; still the same speaker.
    expect(pickActiveIndicatorIndex([DANIIL_IDLE, SERGEY_SPEAKING_LOUDER, SELF_IDLE])).toBe(1);
  });

  it('is not fooled by the extra class on the self tile', () => {
    // The old heuristic counted classes, so the 7-class self tile always won and every replica
    // in the transcript was attributed to the person running the recording (LS-33).
    expect(pickActiveIndicatorIndex([DANIIL_IDLE, SELF_IDLE])).toBeNull();
  });

  it('reports nobody when every indicator is idle', () => {
    expect(pickActiveIndicatorIndex([DANIIL_IDLE, DANIIL_IDLE, SELF_IDLE])).toBeNull();
  });

  it('reports nobody when no indicator is idle', () => {
    // Meet class names are obfuscated and get rotated. If the idle class disappears everywhere,
    // the marker is stale — better no speaker than confidently naming the first tile.
    expect(pickActiveIndicatorIndex([SERGEY_SPEAKING, SERGEY_SPEAKING_LOUDER])).toBeNull();
  });

  it('needs at least two indicators to tell idle from speaking', () => {
    expect(pickActiveIndicatorIndex([SERGEY_SPEAKING])).toBeNull();
    expect(pickActiveIndicatorIndex([])).toBeNull();
  });

  it('picks the first speaker when several talk at once', () => {
    expect(pickActiveIndicatorIndex([DANIIL_IDLE, SERGEY_SPEAKING, SERGEY_SPEAKING])).toBe(1);
  });
});

describe('parseMeetSpeakerName', () => {
  it('reads the name off the tile menu label', () => {
    // The live label format on 2026-08-11 — none of the older patterns matched it, so the
    // transcript arrived with no speaker at all.
    expect(parseMeetSpeakerName('Сергей Чумеров: ещё варианты')).toBe('Сергей Чумеров');
    expect(parseMeetSpeakerName('Aleksandr Ivanov: more options')).toBe('Aleksandr Ivanov');
  });

  it('still reads the pin and mute labels', () => {
    expect(
      parseMeetSpeakerName('Закрепить изображение пользователя Сергей Чумеров на главном экране'),
    ).toBe('Сергей Чумеров');
    expect(parseMeetSpeakerName('Pin Sergey Chumerov to main screen')).toBe('Sergey Chumerov');
    expect(parseMeetSpeakerName("Mute Sergey Chumerov's microphone")).toBe('Sergey Chumerov');
  });

  it('returns null for labels that carry no name', () => {
    expect(parseMeetSpeakerName('Ещё варианты')).toBeNull();
    expect(parseMeetSpeakerName('')).toBeNull();
    expect(parseMeetSpeakerName(null)).toBeNull();
    expect(parseMeetSpeakerName('   ')).toBeNull();
  });
});
