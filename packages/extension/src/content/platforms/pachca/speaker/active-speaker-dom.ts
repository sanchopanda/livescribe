export interface PachcaSpeakerInfo {
  participantId: string;
  speaker: string | null;
}

function getActiveSpeakerFromFilmstrip(): PachcaSpeakerInfo | null {
  const tile = document.querySelector<HTMLElement>(
    '.filmstrip__videos [id^="participant_"].dominant-speaker',
  );
  if (!tile?.id) return null;

  const participantId = tile.id;
  const nameEl =
    document.getElementById(`${participantId}_name`) ??
    tile.querySelector<HTMLElement>('.displayname');

  const speaker = nameEl?.textContent?.trim() || null;

  return { participantId, speaker };
}

function isDynamicShadowActive(el: HTMLElement): boolean {
  const style = el.getAttribute('style') || '';
  return style.includes('box-shadow') && !style.includes('0px 0px 0px 0px');
}

function getActiveSpeakerFromOneOnOne(): PachcaSpeakerInfo | null {
  const dynamicShadow = document.querySelector<HTMLElement>('.dynamic-shadow');
  if (!dynamicShadow) return null;
  if (!isDynamicShadowActive(dynamicShadow)) return null;

  const nameEl = document.querySelector<HTMLElement>('.stage-participant-label');
  const speaker = nameEl?.textContent?.trim() || null;

  return { participantId: 'dominantSpeaker', speaker };
}

export function getPachcaActiveSpeaker(): PachcaSpeakerInfo | null {
  return getActiveSpeakerFromFilmstrip() ?? getActiveSpeakerFromOneOnOne();
}

