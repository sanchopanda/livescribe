export interface TeamsSpeakerInfo {
  participantId: string;
  speaker: string | null;
}

const TILE_SELECTOR = '[data-cid="calling-participant-stream"]';
const SPEAKING_OUTLINE_SELECTOR =
  '[data-tid="voice-level-stream-outline"][data-is-speaking="true"]';

/**
 * A participant can own several tiles at once — video plus screen sharing. The sharing tile
 * carries a differently shaped aria-label ("Общий контент от пользователя X"), so reading it
 * as a speaker tile would put that whole phrase into the transcript instead of a name.
 */
export function isScreenSharingTile(streamType: string | null): boolean {
  return streamType === 'ScreenSharing';
}

/**
 * Speaker name from a participant tile's aria-label.
 * Video tile: "Gevorg Voskanyan, Доступно контекстное меню" → "Gevorg Voskanyan".
 * Sharing tile: "Общий контент от пользователя Gevorg Voskanyan" → "Gevorg Voskanyan".
 */
export function parseTeamsSpeakerName(ariaLabel: string | null): string | null {
  const label = (ariaLabel || '').trim();
  if (!label) return null;

  const sharing =
    label.match(/^Общий контент от пользователя\s+(.+)$/i) ||
    label.match(/^Content shared by\s+(.+)$/i);
  if (sharing?.[1]) return sharing[1].trim() || null;

  return label.split(',')[0]?.trim() || null;
}

/**
 * Stable identity of a participant. `data-tid` holds the UPN and survives re-renders, unlike
 * `data-acc-element-id`, which identifies the tile rather than the person.
 */
export function teamsParticipantId(dataTid: string | null, accElementId: string | null): string {
  return dataTid?.trim() || accElementId?.trim() || 'teams-unknown';
}

export function getTeamsActiveSpeaker(): TeamsSpeakerInfo | null {
  const outlines = document.querySelectorAll<HTMLElement>(SPEAKING_OUTLINE_SELECTOR);

  for (const outline of outlines) {
    const tile = outline.closest<HTMLElement>(TILE_SELECTOR);
    if (!tile) continue;
    // Skip the sharing tile: when someone shares their screen the speaking indicator must be
    // read off their video tile, not off the shared content.
    if (isScreenSharingTile(tile.getAttribute('data-stream-type'))) continue;

    return {
      participantId: teamsParticipantId(
        tile.getAttribute('data-tid'),
        tile.getAttribute('data-acc-element-id'),
      ),
      speaker: parseTeamsSpeakerName(tile.getAttribute('aria-label')),
    };
  }

  return null;
}
