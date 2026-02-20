export interface TeamsSpeakerInfo {
  participantId: string;
  speaker: string | null;
}

export function getTeamsActiveSpeaker(): TeamsSpeakerInfo | null {
  const outline = document.querySelector<HTMLElement>(
    '[data-tid="voice-level-stream-outline"][data-is-speaking="true"]',
  );

  if (!outline) return null;

  const container = outline.closest<HTMLElement>('[data-cid="calling-participant-stream"]');
  if (!container) return null;

  const ariaLabel = container.getAttribute('aria-label') || '';
  const speaker = ariaLabel.split(',')[0]?.trim() || null;
  const participantId = container.getAttribute('data-acc-element-id') || 'teams-unknown';

  return { participantId, speaker };
}
