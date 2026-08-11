export interface MeetTrackOwner {
  participantId: string;
  speaker: string | null;
}

export interface MeetCaptureTarget {
  trackId: string;
  participantId: string;
  speaker: string | null;
}

/**
 * Id for a track that could not be matched to a participant tile. Prefixed the way the backend
 * expects, so an unnamed track shows up as a distinct participant instead of merging into someone
 * else's stream. Short slice of the track id: it is stable across rescans and stays readable in
 * the label the backend derives from it.
 */
export function fallbackParticipantId(trackId: string): string {
  return `participant_${trackId.slice(0, 8)}`;
}

/**
 * Every audio track the WebRTC registry knows about, with an owner where one is known.
 *
 * Capture must not depend on naming. It used to walk the owner map instead of the registry, so a
 * track whose participant tile could not be identified was never recorded at all — and after Meet
 * stopped exposing the ssrc on its tiles that meant every remote participant was silently dropped,
 * leaving only the local microphone in the transcript (LS-35).
 */
export function resolveCaptureTargets(
  registryTrackIds: readonly string[],
  owners: ReadonlyMap<string, MeetTrackOwner>,
): MeetCaptureTarget[] {
  const targets: MeetCaptureTarget[] = [];
  const seen = new Set<string>();

  for (const rawTrackId of registryTrackIds) {
    const trackId = rawTrackId.trim();
    if (!trackId || seen.has(trackId)) continue;
    seen.add(trackId);

    const owner = owners.get(trackId);
    targets.push({
      trackId,
      participantId: owner?.participantId ?? fallbackParticipantId(trackId),
      speaker: owner?.speaker ?? null,
    });
  }

  return targets;
}
