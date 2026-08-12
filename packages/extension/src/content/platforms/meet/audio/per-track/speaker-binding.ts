import { VAD_DEFAULTS } from '../../../../per-track/core/vad';

export interface TrackEnergy {
  trackId: string;
  rms: number;
}

export interface BindingObservation {
  tracks: readonly TrackEnergy[];
  /** Own microphone: it talks over everyone and must not spoil an otherwise clean observation. */
  localTrackIds?: readonly string[];
  domSpeaker: { participantId: string; speaker: string | null } | null;
}

export interface BindingChange {
  trackId: string;
  participantId: string;
  speaker: string;
}

/** Agreeing observations needed before a name is trusted. */
export const CONFIRM_HITS = 3;
/** Disagreeing observations before a confirmed binding is dropped — Meet reuses audio slots. */
export const RESET_MISSES = 3;

interface Candidate {
  participantId: string;
  speaker: string;
  hits: number;
}

interface Confirmed {
  participantId: string;
  speaker: string;
  // A miss streak belongs to exactly one challenger: three noisy reads naming three different
  // people are not evidence that any one of them owns the slot, so only consecutive misses from
  // the *same* participant may accumulate toward dropping the binding.
  lastDisagreeingParticipantId?: string;
  misses: number;
}

export class TrackSpeakerBinding {
  private candidateByTrackId = new Map<string, Candidate>();
  private confirmedByTrackId = new Map<string, Confirmed>();

  observe(observation: BindingObservation): BindingChange[] {
    const speaker = observation.domSpeaker;
    if (!speaker?.speaker) return [];

    const localTrackIds = observation.localTrackIds ?? [];

    // The self tile is non-idle exactly when the recorder is speaking, so the tile highlight
    // cannot be trusted to point at a remote participant while the local mic is loud: the owner
    // talking over a remote participant would otherwise look like a clean, single-track
    // observation and confirm the remote track under the OWNER's name. A wrong binding here
    // writes an unrecoverable relabel into stored transcript segments, so the whole observation
    // is discarded before any counting — not just the local track excluded from it.
    const localIsLoud = observation.tracks.some(
      (track) => localTrackIds.includes(track.trackId) && track.rms >= VAD_DEFAULTS.rmsOn,
    );
    if (localIsLoud) return [];

    const active = observation.tracks.filter(
      (track) => !localTrackIds.includes(track.trackId) && track.rms >= VAD_DEFAULTS.rmsOn,
    );
    if (active.length !== 1) return [];

    const trackId = active[0].trackId;
    const confirmed = this.confirmedByTrackId.get(trackId);

    if (confirmed && confirmed.participantId === speaker.participantId) {
      confirmed.misses = 0;
      confirmed.lastDisagreeingParticipantId = undefined;
      return [];
    }

    if (confirmed) {
      // Disagreement from a different participant: only consecutive observations accumulate.
      if (confirmed.lastDisagreeingParticipantId === speaker.participantId) {
        confirmed.misses += 1;
      } else {
        confirmed.lastDisagreeingParticipantId = speaker.participantId;
        confirmed.misses = 1;
      }

      if (confirmed.misses < RESET_MISSES) return [];
      // Too many misses from this participant, drop the binding. Do not immediately confirm the new participant.
      this.confirmedByTrackId.delete(trackId);
      this.candidateByTrackId.delete(trackId);
      return [];
    }

    const candidate = this.candidateByTrackId.get(trackId);
    if (!candidate || candidate.participantId !== speaker.participantId) {
      this.candidateByTrackId.set(trackId, {
        participantId: speaker.participantId,
        speaker: speaker.speaker,
        hits: 1,
      });
      return [];
    }

    candidate.hits += 1;
    candidate.speaker = speaker.speaker;
    if (candidate.hits < CONFIRM_HITS) return [];

    this.candidateByTrackId.delete(trackId);
    this.dropOtherTracksOf(speaker.participantId, trackId);
    this.confirmedByTrackId.set(trackId, {
      participantId: speaker.participantId,
      speaker: speaker.speaker,
      lastDisagreeingParticipantId: undefined,
      misses: 0,
    });

    return [{ trackId, participantId: speaker.participantId, speaker: speaker.speaker }];
  }

  speakerFor(trackId: string): string | null {
    return this.confirmedByTrackId.get(trackId)?.speaker ?? null;
  }

  reset(): void {
    this.candidateByTrackId.clear();
    this.confirmedByTrackId.clear();
  }

  /** One participant speaks on one slot at a time: an older binding for them is stale. */
  private dropOtherTracksOf(participantId: string, keepTrackId: string): void {
    for (const [trackId, entry] of this.confirmedByTrackId) {
      if (trackId !== keepTrackId && entry.participantId === participantId) {
        this.confirmedByTrackId.delete(trackId);
      }
    }
  }
}
