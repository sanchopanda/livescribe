export interface MeetSpeakerInfo {
  participantId: string;
  speaker: string | null;
}

/**
 * Extract speaker name from a Meet participant tile.
 * Uses aria-label (most stable) then falls back to span.notranslate.
 */
export function extractMeetSpeakerName(tile: HTMLElement): string | null {
  // aria-label on buttons inside tile — stable, not obfuscated
  // Russian: "Закрепить изображение пользователя {Name} на главном экране"
  // English: "Pin {Name} to main screen" / "Mute {Name}'s microphone"
  const ariaEls = tile.querySelectorAll<HTMLElement>('[aria-label]');
  for (const el of ariaEls) {
    const label = el.getAttribute('aria-label') || '';

    const ruMatch = label.match(/пользователя (.+?) на/i);
    if (ruMatch?.[1]) return ruMatch[1].trim();

    const enPinMatch = label.match(/^Pin (.+?) to\b/i);
    if (enPinMatch?.[1]) return enPinMatch[1].trim();

    const enMuteMatch = label.match(/^Mute (.+?)(?:'s|'s)?\s+mic/i);
    if (enMuteMatch?.[1]) return enMuteMatch[1].trim();
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
 * The audio bars element has jscontroller="tae9tc" jsname="QgSmzd".
 * When speaking, Google Meet adds an extra CSS class to it (the class name is
 * obfuscated and may change). We detect activity by comparing classList length:
 * idle tiles have a fixed baseline of classes, speaking tiles have one extra.
 * We pick the tile with the most classes on its indicator as the active speaker.
 */
export function getMeetActiveSpeaker(): MeetSpeakerInfo | null {
  const indicators = document.querySelectorAll<HTMLElement>(
    '[jscontroller="tae9tc"][jsname="QgSmzd"]',
  );

  if (indicators.length === 0) return null;

  // Find the minimum classList size (idle baseline)
  let minClasses = Infinity;
  indicators.forEach((el) => {
    if (el.classList.length < minClasses) {
      minClasses = el.classList.length;
    }
  });

  // Find indicator with more classes than baseline (active speaker)
  let activeTile: HTMLElement | null = null;
  for (const indicator of indicators) {
    if (indicator.classList.length > minClasses) {
      const tile = indicator.closest<HTMLElement>('[data-participant-id]');
      if (tile) {
        activeTile = tile;
        break;
      }
    }
  }

  if (!activeTile) return null;

  const participantId = activeTile.getAttribute('data-participant-id') || 'meet-active-speaker';
  const speaker = extractMeetSpeakerName(activeTile);

  return { participantId, speaker };
}
