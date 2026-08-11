export interface MeetSpeakerInfo {
  participantId: string;
  speaker: string | null;
}

/** Meet renders the tile mic state as a material icon name inside the button. */
export function isMutedMicIcon(iconText: string | null | undefined): boolean {
  return iconText?.trim() === 'mic_off';
}

/**
 * The class Meet puts on an idle audio-bars element. A speaking participant carries a level class
 * in its place (`Oaajhc`, `HX2H7`, … — the value tracks loudness), never this one.
 *
 * Обфусцировано и однажды сменится: `pickActiveIndicatorIndex` рассчитан на это и молчит, когда
 * маркер перестал совпадать, вместо того чтобы назвать первого участника подряд.
 */
const MEET_IDLE_INDICATOR_CLASS = 'gjg47c';

/**
 * Which of the audio-bars elements belongs to the participant currently speaking.
 *
 * Speaking is a *substituted* class, not an extra one. The previous version compared classList
 * lengths, and the local participant's tile carries a permanent extra class (`KUNJSe`) — so it
 * always looked like the loudest one and the whole transcript ended up under the recorder's own
 * name (LS-33).
 *
 * Returns null — «не знаю», leaving the last known speaker in place — when the answer cannot be
 * trusted: fewer than two indicators to compare, everyone idle, or nobody idle (a stale marker).
 */
export function pickActiveIndicatorIndex(classLists: readonly string[][]): number | null {
  if (classLists.length < 2) return null;

  const speaking = classLists
    .map((classes, index) => ({ index, classes }))
    .filter(({ classes }) => !classes.includes(MEET_IDLE_INDICATOR_CLASS));

  if (speaking.length === 0 || speaking.length === classLists.length) return null;

  return speaking[0].index;
}

/**
 * Pull a participant name out of one `aria-label` — the only names on a Meet tile that are not
 * obfuscated. Labels seen in the wild:
 *  - "{Name}: ещё варианты" / "{Name}: more options" — the per-tile menu button
 *  - "Закрепить изображение пользователя {Name} на главном экране" / "Pin {Name} to main screen"
 *  - "Mute {Name}'s microphone"
 */
export function parseMeetSpeakerName(label: string | null | undefined): string | null {
  const value = label?.trim();
  if (!value) return null;

  const menuMatch = value.match(/^(.+?):\s*(?:ещё варианты|more options)$/i);
  if (menuMatch?.[1]) return menuMatch[1].trim();

  const ruPinMatch = value.match(/пользователя (.+?) на/i);
  if (ruPinMatch?.[1]) return ruPinMatch[1].trim();

  const enPinMatch = value.match(/^Pin (.+?) to\b/i);
  if (enPinMatch?.[1]) return enPinMatch[1].trim();

  const enMuteMatch = value.match(/^Mute (.+?)(?:'s|’s)?\s+mic/i);
  if (enMuteMatch?.[1]) return enMuteMatch[1].trim();

  return null;
}

/**
 * Extract speaker name from a Meet participant tile.
 * Uses aria-label (most stable) then falls back to span.notranslate.
 */
export function extractMeetSpeakerName(tile: HTMLElement): string | null {
  const ariaEls = tile.querySelectorAll<HTMLElement>('[aria-label]');
  for (const el of ariaEls) {
    const name = parseMeetSpeakerName(el.getAttribute('aria-label'));
    if (name) return name;
  }

  // Fallback: first non-empty notranslate span inside tile
  const spans = tile.querySelectorAll<HTMLElement>('span.notranslate');
  for (const span of spans) {
    const text = span.textContent?.trim();
    if (text) return text;
  }

  return null;
}

/**
 * Detect the currently active/speaking participant from the Meet DOM.
 *
 * The audio bars element has jscontroller="tae9tc" jsname="QgSmzd"; which of them is speaking is
 * decided by `pickActiveIndicatorIndex`.
 */
export function getMeetActiveSpeaker(): MeetSpeakerInfo | null {
  const indicators = [
    ...document.querySelectorAll<HTMLElement>('[jscontroller="tae9tc"][jsname="QgSmzd"]'),
  ];

  const activeIndex = pickActiveIndicatorIndex(indicators.map((el) => [...el.classList]));
  if (activeIndex === null) return null;

  const activeTile = indicators[activeIndex].closest<HTMLElement>('[data-participant-id]');
  if (!activeTile) return null;

  const participantId = activeTile.getAttribute('data-participant-id') || 'meet-active-speaker';
  const speaker = extractMeetSpeakerName(activeTile);

  return { participantId, speaker };
}

/**
 * Participants whose microphone is off. They cannot be the source of any audio, so binding must
 * not consider them candidates even if the highlight momentarily points at them.
 */
export function collectMutedMeetParticipantIds(): string[] {
  const muted: string[] = [];

  document.querySelectorAll<HTMLElement>('[data-participant-id]').forEach((tile) => {
    const participantId = tile.getAttribute('data-participant-id');
    if (!participantId) return;

    const icons = tile.querySelectorAll<HTMLElement>('i.google-symbols');
    for (const icon of icons) {
      if (isMutedMicIcon(icon.textContent)) {
        muted.push(participantId);
        return;
      }
    }
  });

  return muted;
}
