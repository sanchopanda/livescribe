import { analyzeChunkSignal } from '../../../../per-track/core/audio-signal';
import { decideVad, type TrackVadState } from '../../../../per-track/core/vad';
import {
  PRE_ROLL_MS,
  PreRollBuffer,
  type BufferedTrackChunk,
} from '../../../../per-track/core/pre-roll';
import { collectMutedMeetParticipantIds, extractMeetSpeakerName, getMeetActiveSpeaker } from '../../speaker/active-speaker-dom';
import { resolveCaptureTargets, type MeetTrackOwner } from './capture-targets';
import { TrackSpeakerBinding } from './speaker-binding';
import { collectTrackEnergies, recordTrackEnergy, type TrackEnergySample } from './track-energy';

interface MainWorldWebRTCTrackSnapshot {
  trackId: string;
  streamId: string | null;
  ssrc: string | null;
  createdAt: number;
}

interface ActiveTrackCapture {
  trackId: string;
  participantId: string;
  speaker: string | null;
  sourceNode: MediaStreamAudioSourceNode;
  workletNode: AudioWorkletNode;
}

interface ChunkTrackStats {
  chunks: number;
  sentChunks: number;
  droppedChunks: number;
  bytes: number;
  firstChunkAt: number;
  lastChunkAt: number;
  avgRms: number;
  maxRms: number;
  avgPeak: number;
  maxPeak: number;
}

const RESCAN_INTERVAL_MS = 1500;
const AUDIO_LEVEL_SEND_INTERVAL_MS = 200;
const TRACK_DEBUG = localStorage.getItem('livescribe-track-transcriber-debug') !== '0';
const WEBRTC_REGISTRY_SELECTOR = 'audio[data-livescribe-source="webrtc-registry"]';
const LOCAL_REGISTRY_SELECTOR = `${WEBRTC_REGISTRY_SELECTOR}[data-local="true"]`;

/**
 * The local microphone has no participant tile to read a name from. Labelling it "Вы" is what a
 * reader of the transcript needs anyway.
 */
const SELF_OWNER: MeetTrackOwner = { participantId: 'self', speaker: 'Вы' };
const MEET_SOURCE = 'livescribe-meet-webrtc-tracks';

function debugLog(...args: unknown[]): void {
  if (!TRACK_DEBUG) return;
  console.log('[LiveScribe][Meet][TrackTranscriber]', ...args);
}

function normalizeSpeakerName(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

/**
 * Map WebRTC registry audio elements to Meet participant owners.
 *
 * Strategy 1 (primary): Match registry data-ssrc → DOM [data-ssrc] → closest [data-participant-id] tile
 * Strategy 2 (fallback): Match registry srcObject audio tracks → <video> srcObject inside tiles
 */
function extractOwnerByTrackId(): Map<string, MeetTrackOwner> {
  const result = new Map<string, MeetTrackOwner>();

  const registryEls = document.querySelectorAll<HTMLMediaElement>(WEBRTC_REGISTRY_SELECTOR);

  // Strategy 1: SSRC-based matching
  registryEls.forEach((mediaEl) => {
    const ssrc = mediaEl.getAttribute('data-ssrc');
    if (!ssrc) return;

    // Meet tiles have a div with data-ssrc inside the tile
    const domSsrcEl = document.querySelector<HTMLElement>(`[data-ssrc="${ssrc}"]`);
    if (!domSsrcEl) return;

    const tile = domSsrcEl.closest<HTMLElement>('[data-participant-id]');
    if (!tile) return;

    const participantId = tile.getAttribute('data-participant-id') || '';
    if (!participantId) return;

    const speaker = normalizeSpeakerName(extractMeetSpeakerName(tile));

    const stream = mediaEl.srcObject;
    if (!(stream instanceof MediaStream)) return;

    stream.getAudioTracks().forEach((track) => {
      if (track.id) {
        result.set(track.id, { participantId, speaker });
      }
    });
  });

  // Strategy 2: srcObject stream matching — scan video elements inside tiles
  const tiles = document.querySelectorAll<HTMLElement>('[data-participant-id]');
  tiles.forEach((tile) => {
    const participantId = tile.getAttribute('data-participant-id') || '';
    if (!participantId) return;

    const speaker = normalizeSpeakerName(extractMeetSpeakerName(tile));

    // Check media elements directly inside the tile
    tile.querySelectorAll<HTMLMediaElement>('video, audio').forEach((mediaEl) => {
      const stream = mediaEl.srcObject;
      if (!(stream instanceof MediaStream)) return;

      stream.getAudioTracks().forEach((track) => {
        if (track.id && !result.has(track.id)) {
          result.set(track.id, { participantId, speaker });
        }
      });
    });

    // Also check registry elements whose srcObject matches any stream in the tile
    registryEls.forEach((regEl) => {
      const regStream = regEl.srcObject;
      if (!(regStream instanceof MediaStream)) return;

      const streamId = regEl.getAttribute('data-stream-id') || regStream.id;
      if (!streamId) return;

      // Match by stream ID seen in tile media elements
      tile.querySelectorAll<HTMLMediaElement>('video, audio').forEach((tileMedia) => {
        const tileStream = tileMedia.srcObject;
        if (!(tileStream instanceof MediaStream)) return;
        if (tileStream.id !== streamId) return;

        regStream.getAudioTracks().forEach((track) => {
          if (track.id && !result.has(track.id)) {
            result.set(track.id, { participantId, speaker });
          }
        });
      });
    });
  });

  // Own microphone last, so it wins: the MAIN-world hook registers it from the sending side, and
  // none of the tile lookups above can identify it — Meet's self-view carries no usable name.
  document.querySelectorAll<HTMLMediaElement>(LOCAL_REGISTRY_SELECTOR).forEach((mediaEl) => {
    const stream = mediaEl.srcObject;
    if (!(stream instanceof MediaStream)) return;

    stream.getAudioTracks().forEach((track) => {
      if (!track.id) return;
      result.set(track.id, SELF_OWNER);
    });
  });

  return result;
}

export class MeetTrackTranscriber {
  private audioContext: AudioContext | null = null;
  private capturesByTrackId = new Map<string, ActiveTrackCapture>();
  private ownerByTrackId = new Map<string, MeetTrackOwner>();
  private sessionId: string | null = null;
  private running = false;
  private rescanTimerId: number | null = null;
  private startupDiagnosticsTimerId: number | null = null;
  private chunkStatsTimerId: number | null = null;
  private lastMapSignature: string | null = null;
  private lastMainWorldSnapshotSignature: string | null = null;
  private webRTCMessageListenerAttached = false;
  private missingTrackLogged = new Set<string>();
  private chunkStatsByTrackId = new Map<string, ChunkTrackStats>();
  private vadStateByTrackId = new Map<string, TrackVadState>();
  private lastLevelSentAtByTrackId = new Map<string, number>();
  private readonly preRoll = new PreRollBuffer();
  private readonly binding = new TrackSpeakerBinding();
  private readonly energyByTrackId = new Map<string, TrackEnergySample>();
  private bindingTimerId: number | null = null;

  async start(sessionId: string): Promise<void> {
    if (this.running) {
      this.sessionId = sessionId;
      return;
    }

    this.running = true;
    this.sessionId = sessionId;
    debugLog('start', { sessionId });

    this.attachWebRTCMainMessageListener();

    this.audioContext = new AudioContext({ sampleRate: 16000 });
    await this.audioContext.audioWorklet.addModule(chrome.runtime.getURL('processor.worklet.js'));

    await this.syncTracks();

    if (this.startupDiagnosticsTimerId !== null) {
      clearTimeout(this.startupDiagnosticsTimerId);
    }
    this.startupDiagnosticsTimerId = window.setTimeout(() => {
      if (!this.running) return;
      if (this.capturesByTrackId.size > 0) return;

      const participantTiles = document.querySelectorAll('[data-participant-id]').length;
      const mediaElements = document.querySelectorAll('video, audio').length;
      const mediaWithSrcObject = [...document.querySelectorAll<HTMLMediaElement>('video, audio')].filter(
        (el) => el.srcObject instanceof MediaStream,
      ).length;
      const registryElements = document.querySelectorAll(WEBRTC_REGISTRY_SELECTOR).length;

      console.warn('[LiveScribe][Meet][TrackTranscriber] no active track captures after start', {
        ownerMappings: this.ownerByTrackId.size,
        participantTiles,
        mediaElements,
        mediaWithSrcObject,
        registryElements,
      });
    }, 4000);

    this.rescanTimerId = window.setInterval(() => {
      this.syncTracks().catch(() => {
        // ignore scan errors
      });
    }, RESCAN_INTERVAL_MS);

    this.chunkStatsTimerId = window.setInterval(() => {
      if (!this.running || this.chunkStatsByTrackId.size === 0) return;

      const summary = [...this.chunkStatsByTrackId.entries()].map(([trackId, stats]) => ({
        trackId,
        chunks: stats.chunks,
        sentChunks: stats.sentChunks,
        droppedChunks: stats.droppedChunks,
        bytes: stats.bytes,
        ageMs: Date.now() - stats.firstChunkAt,
        idleMs: Date.now() - stats.lastChunkAt,
        avgRms: Number(stats.avgRms.toFixed(5)),
        maxRms: Number(stats.maxRms.toFixed(5)),
        avgPeak: Number(stats.avgPeak.toFixed(5)),
        maxPeak: Number(stats.maxPeak.toFixed(5)),
      }));

      console.log('[LiveScribe][Meet][TrackTranscriber] chunk stats', {
        tracks: summary.length,
        summary,
      });
    }, 3000);

    // Один такт в 250 мс — тот же ритм, что у опроса DOM-детектора в content.ts.
    this.bindingTimerId = window.setInterval(() => {
      if (!this.running || this.capturesByTrackId.size === 0) return;

      const now = Date.now();
      const trackIds = [...this.capturesByTrackId.keys()];
      const localTrackIds = trackIds.filter(
        (trackId) => this.capturesByTrackId.get(trackId)?.participantId === SELF_OWNER.participantId,
      );

      const changes = this.binding.observe({
        tracks: collectTrackEnergies(this.energyByTrackId, trackIds, now),
        localTrackIds,
        domSpeaker: getMeetActiveSpeaker(),
        mutedParticipantIds: collectMutedMeetParticipantIds(),
      });

      for (const change of changes) {
        const capture = this.capturesByTrackId.get(change.trackId);
        if (!capture) continue;

        debugLog('speaker bound', {
          trackId: change.trackId,
          participantId: capture.participantId,
          speaker: change.speaker,
        });
        capture.speaker = change.speaker;

        chrome.runtime
          .sendMessage({
            type: 'PARTICIPANT_RENAME',
            sessionId: this.sessionId,
            participantId: capture.participantId,
            speaker: change.speaker,
          })
          .catch(() => {
            // service worker may be inactive momentarily
          });
      }
    }, 250);
  }

  async stop(): Promise<void> {
    debugLog('stop');
    this.running = false;
    this.sessionId = null;

    if (this.rescanTimerId !== null) {
      clearInterval(this.rescanTimerId);
      this.rescanTimerId = null;
    }

    if (this.startupDiagnosticsTimerId !== null) {
      clearTimeout(this.startupDiagnosticsTimerId);
      this.startupDiagnosticsTimerId = null;
    }

    if (this.chunkStatsTimerId !== null) {
      clearInterval(this.chunkStatsTimerId);
      this.chunkStatsTimerId = null;
    }

    if (this.bindingTimerId !== null) {
      clearInterval(this.bindingTimerId);
      this.bindingTimerId = null;
    }

    for (const [trackId, capture] of this.capturesByTrackId) {
      try {
        capture.workletNode.port.onmessage = null;
        capture.sourceNode.disconnect();
        capture.workletNode.disconnect();
      } catch {
        // ignore disconnect errors
      }
      this.capturesByTrackId.delete(trackId);
    }

    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch {
        // ignore close errors
      }
      this.audioContext = null;
    }

    this.ownerByTrackId.clear();
    this.detachWebRTCMainMessageListener();
    this.missingTrackLogged.clear();
    this.chunkStatsByTrackId.clear();
    this.vadStateByTrackId.clear();
    this.lastLevelSentAtByTrackId.clear();
    this.preRoll.clear();
    this.binding.reset();
    this.energyByTrackId.clear();
    this.lastMainWorldSnapshotSignature = null;
  }

  private attachWebRTCMainMessageListener(): void {
    if (this.webRTCMessageListenerAttached) return;

    window.addEventListener('message', this.handleMainWorldMessage);
    this.webRTCMessageListenerAttached = true;
    console.log('[LiveScribe][Meet][TrackTranscriber] listening MAIN-world WebRTC snapshots');
  }

  private detachWebRTCMainMessageListener(): void {
    if (!this.webRTCMessageListenerAttached) return;

    window.removeEventListener('message', this.handleMainWorldMessage);
    this.webRTCMessageListenerAttached = false;
  }

  private handleMainWorldMessage = (event: MessageEvent): void => {
    const data = event.data;
    if (!data || data.source !== MEET_SOURCE || data.type !== 'snapshot') {
      return;
    }

    const tracks = (data.tracks || []) as MainWorldWebRTCTrackSnapshot[];
    const signature = tracks
      .map((track) => `${track.trackId}|${track.streamId ?? 'none'}|${track.ssrc ?? 'no-ssrc'}`)
      .sort()
      .join(';');

    if (signature === this.lastMainWorldSnapshotSignature) {
      return;
    }
    this.lastMainWorldSnapshotSignature = signature;

    console.log('[LiveScribe][Meet][TrackTranscriber] MAIN-world snapshot', {
      reason: data.reason,
      tracks: tracks.length,
      sample: tracks.slice(0, 5),
    });

    // Trigger immediate resync when snapshot arrives (e.g. after ssrc-discovered)
    this.syncTracks().catch(() => {});
  };

  private async syncTracks(): Promise<void> {
    if (!this.running || !this.audioContext) return;

    this.ownerByTrackId = extractOwnerByTrackId();
    this.logTrackMapIfChanged();

    // Refresh speaker names for active captures
    for (const [trackId, capture] of this.capturesByTrackId) {
      const owner = this.ownerByTrackId.get(trackId);
      if (owner) {
        capture.participantId = owner.participantId;
        capture.speaker = owner.speaker;
      }
    }

    const targets = resolveCaptureTargets(this.collectRegistryTrackIds(), this.ownerByTrackId);

    for (const target of targets) {
      const { trackId, participantId, speaker } = target;
      if (this.capturesByTrackId.has(trackId)) continue;

      const track = this.findAudioTrackById(trackId);
      if (!track) {
        if (!this.missingTrackLogged.has(trackId)) {
          this.missingTrackLogged.add(trackId);
          console.warn('[LiveScribe][Meet][TrackTranscriber] registry track not found', {
            trackId,
            participantId,
            speaker,
          });
        }
        continue;
      }

      this.missingTrackLogged.delete(trackId);
      await this.startTrackCapture(track, { participantId, speaker });
    }
  }

  /** Every audio track the MAIN-world hook registered, named or not. */
  private collectRegistryTrackIds(): string[] {
    const trackIds: string[] = [];

    document.querySelectorAll<HTMLMediaElement>(WEBRTC_REGISTRY_SELECTOR).forEach((mediaEl) => {
      const stream = mediaEl.srcObject;
      if (!(stream instanceof MediaStream)) return;

      stream.getAudioTracks().forEach((track) => {
        if (track.id) trackIds.push(track.id);
      });
    });

    return trackIds;
  }

  private logTrackMapIfChanged(): void {
    const items = [...this.ownerByTrackId.entries()]
      .map(([trackId, owner]) => `${trackId}=>${owner.participantId}:${owner.speaker ?? 'unknown'}`)
      .sort();

    const signature = items.join('|');
    if (signature === this.lastMapSignature) return;

    this.lastMapSignature = signature;
    debugLog('track map updated', {
      tracks: items.length,
      mapping: items,
    });

    if (items.length === 0) {
      const tilesCount = document.querySelectorAll('[data-participant-id]').length;
      const mediaCount = document.querySelectorAll('video, audio').length;
      const mediaWithStream = [...document.querySelectorAll<HTMLMediaElement>('video, audio')].filter(
        (el) => el.srcObject instanceof MediaStream,
      ).length;
      const registryElements = document.querySelectorAll(WEBRTC_REGISTRY_SELECTOR).length;

      console.warn('[LiveScribe][Meet][TrackTranscriber] no track owners detected', {
        participantTiles: tilesCount,
        mediaElements: mediaCount,
        mediaWithSrcObject: mediaWithStream,
        webrtcRegistryElements: registryElements,
      });
    }
  }

  private findAudioTrackById(trackId: string): MediaStreamTrack | null {
    const registryMediaEls = document.querySelectorAll<HTMLMediaElement>(WEBRTC_REGISTRY_SELECTOR);
    for (const mediaEl of registryMediaEls) {
      const stream = mediaEl.srcObject;
      if (!(stream instanceof MediaStream)) continue;

      const found = stream.getAudioTracks().find((track) => track.id === trackId);
      if (found) return found;
    }

    const mediaEls = document.querySelectorAll<HTMLMediaElement>('video, audio');
    for (const mediaEl of mediaEls) {
      const stream = mediaEl.srcObject;
      if (!(stream instanceof MediaStream)) continue;

      const found = stream.getAudioTracks().find((track) => track.id === trackId);
      if (found) return found;
    }

    return null;
  }

  private async startTrackCapture(track: MediaStreamTrack, owner: MeetTrackOwner): Promise<void> {
    if (!this.audioContext || this.capturesByTrackId.has(track.id)) return;

    const stream = new MediaStream([track]);
    const sourceNode = this.audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor');

    const capture: ActiveTrackCapture = {
      trackId: track.id,
      participantId: owner.participantId,
      speaker: owner.speaker,
      sourceNode,
      workletNode,
    };

    workletNode.port.onmessage = (event) => {
      if (!this.running || !this.sessionId) return;
      if (event.data?.type !== 'audio-chunk') return;

      const chunk = event.data.chunk as ArrayBuffer;
      this.sendChunkToOffscreen(chunk, capture.trackId, capture.participantId, capture.speaker);
    };

    sourceNode.connect(workletNode);
    this.capturesByTrackId.set(track.id, capture);
    console.log('[LiveScribe][Meet][TrackTranscriber] capture started', {
      trackId: track.id,
      participantId: owner.participantId,
      speaker: owner.speaker,
      muted: track.muted,
      readyState: track.readyState,
    });

    track.addEventListener('mute', () => {
      console.log('[LiveScribe][Meet][TrackTranscriber] capture track muted', {
        trackId: track.id,
        participantId: capture.participantId,
        speaker: capture.speaker,
      });
    });

    track.addEventListener('unmute', () => {
      console.log('[LiveScribe][Meet][TrackTranscriber] capture track unmuted', {
        trackId: track.id,
        participantId: capture.participantId,
        speaker: capture.speaker,
      });
    });

    track.addEventListener('ended', () => {
      console.log('[LiveScribe][Meet][TrackTranscriber] capture track ended', {
        trackId: track.id,
        participantId: capture.participantId,
        speaker: capture.speaker,
      });
      this.capturesByTrackId.delete(track.id);
      this.preRoll.drop(track.id);
    });
  }

  private bufferPreRollChunk(trackId: string, chunk: ArrayBuffer): void {
    this.preRoll.push(trackId, chunk);
  }

  private consumePreRollChunks(trackId: string): BufferedTrackChunk[] {
    return this.preRoll.consume(trackId);
  }

  private sendPcmChunkToOffscreen(
    chunk: ArrayBuffer,
    participantId: string,
    speaker: string | null,
  ): void {
    const bytes = new Uint8Array(chunk);
    let binary = '';
    for (let index = 0; index < bytes.byteLength; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    const base64 = btoa(binary);

    chrome.runtime
      .sendMessage({
        type: 'TRACK_AUDIO_CHUNK',
        sessionId: this.sessionId,
        participantId,
        speaker,
        sampleRate: 16000,
        channels: 1,
        chunk: base64,
      })
      .catch(() => {
        // service worker may be inactive momentarily
      });
  }

  private sendChunkToOffscreen(
    chunk: ArrayBuffer,
    trackId: string,
    participantId: string,
    speaker: string | null,
  ): void {
    const signal = analyzeChunkSignal(chunk);
    const now = Date.now();
    recordTrackEnergy(this.energyByTrackId, trackId, signal.rms, now);

    // Speaker binding overrides the DOM-tile-derived name once it has confirmed one for this
    // track; participantId never changes, only which name rides along with the audio.
    const boundSpeaker = this.binding.speakerFor(trackId) ?? speaker;

    const lastLevelSentAt = this.lastLevelSentAtByTrackId.get(trackId) ?? 0;
    if (now - lastLevelSentAt >= AUDIO_LEVEL_SEND_INTERVAL_MS) {
      this.lastLevelSentAtByTrackId.set(trackId, now);
      chrome.runtime
        .sendMessage({
          type: 'TRACK_AUDIO_LEVEL',
          participantId,
          speaker: boundSpeaker,
          rms: signal.rms,
          peak: signal.peak,
          timestamp: now,
        })
        .catch(() => {
          // service worker may be inactive momentarily
        });
    }

    const prevVadState = this.vadStateByTrackId.get(trackId);
    const vadDecision = decideVad(prevVadState, signal, now);
    const shouldSend = vadDecision.shouldSend;

    if (vadDecision.opened) {
      console.log('[LiveScribe][Meet][TrackTranscriber] VAD opened', {
        trackId,
        participantId,
        speaker,
        rms: Number(signal.rms.toFixed(5)),
        peak: Number(signal.peak.toFixed(5)),
      });
    }

    if (vadDecision.closed) {
      console.log('[LiveScribe][Meet][TrackTranscriber] VAD closed', {
        trackId,
        participantId,
        speaker,
        rms: Number(signal.rms.toFixed(5)),
        peak: Number(signal.peak.toFixed(5)),
      });
    }

    this.vadStateByTrackId.set(trackId, vadDecision.state);

    const prev = this.chunkStatsByTrackId.get(trackId);
    const nextStats: ChunkTrackStats = prev
      ? {
          chunks: prev.chunks + 1,
          sentChunks: prev.sentChunks + (shouldSend ? 1 : 0),
          droppedChunks: prev.droppedChunks + (shouldSend ? 0 : 1),
          bytes: prev.bytes + chunk.byteLength,
          firstChunkAt: prev.firstChunkAt,
          lastChunkAt: now,
          avgRms: (prev.avgRms * prev.chunks + signal.rms) / (prev.chunks + 1),
          maxRms: Math.max(prev.maxRms, signal.rms),
          avgPeak: (prev.avgPeak * prev.chunks + signal.peak) / (prev.chunks + 1),
          maxPeak: Math.max(prev.maxPeak, signal.peak),
        }
      : {
          chunks: 1,
          sentChunks: shouldSend ? 1 : 0,
          droppedChunks: shouldSend ? 0 : 1,
          bytes: chunk.byteLength,
          firstChunkAt: now,
          lastChunkAt: now,
          avgRms: signal.rms,
          maxRms: signal.rms,
          avgPeak: signal.peak,
          maxPeak: signal.peak,
        };

    this.chunkStatsByTrackId.set(trackId, nextStats);

    if (!prev || (prev.sentChunks === 0 && shouldSend)) {
      console.log('[LiveScribe][Meet][TrackTranscriber] first chunk from track', {
        trackId,
        participantId,
        speaker,
        bytes: chunk.byteLength,
        rms: Number(signal.rms.toFixed(5)),
        peak: Number(signal.peak.toFixed(5)),
        sentByVad: shouldSend,
      });
    }

    if (!shouldSend) {
      this.bufferPreRollChunk(trackId, chunk);
      return;
    }

    if (vadDecision.opened) {
      const preRollChunks = this.consumePreRollChunks(trackId);
      if (preRollChunks.length > 0) {
        debugLog('sending pre-roll chunks', {
          trackId,
          participantId,
          chunks: preRollChunks.length,
          bytes: preRollChunks.reduce((total, item) => total + item.byteLength, 0),
          preRollMs: PRE_ROLL_MS,
        });
        preRollChunks.forEach((preRollChunk) => {
          this.sendPcmChunkToOffscreen(preRollChunk.chunk, participantId, boundSpeaker);
        });
      }
    }

    this.sendPcmChunkToOffscreen(chunk, participantId, boundSpeaker);
  }
}
