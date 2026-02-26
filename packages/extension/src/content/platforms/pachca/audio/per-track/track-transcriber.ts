import { analyzeChunkSignal } from '../../../../per-track/core/audio-signal';
import { decideVad, type TrackVadState } from '../../../../per-track/core/vad';

interface PachcaTrackOwner {
  participantId: string;
  speaker: string | null;
}

interface MainWorldWebRTCTrackSnapshot {
  trackId: string;
  streamId: string | null;
  endpointId: string | null;
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

interface BufferedTrackChunk {
  chunk: ArrayBuffer;
  byteLength: number;
}

const RESCAN_INTERVAL_MS = 1500;
const AUDIO_LEVEL_SEND_INTERVAL_MS = 200;
const PRE_ROLL_MS = 500;
const PRE_ROLL_SAMPLE_RATE = 16000;
const PRE_ROLL_CHANNELS = 1;
const PRE_ROLL_BYTES_PER_SAMPLE = 2;
const PRE_ROLL_MAX_BYTES =
  PRE_ROLL_SAMPLE_RATE * PRE_ROLL_CHANNELS * PRE_ROLL_BYTES_PER_SAMPLE * (PRE_ROLL_MS / 1000);
const TRACK_DEBUG = localStorage.getItem('livescribe-track-transcriber-debug') !== '0';
const WEBRTC_REGISTRY_SELECTOR = 'audio[data-livescribe-source="webrtc-registry"]';

function debugLog(...args: unknown[]): void {
  if (!TRACK_DEBUG) return;
  console.log('[LiveScribe][Pachca][TrackTranscriber]', ...args);
}

function normalizeSpeakerName(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function getSpeakerFromTile(tile: HTMLElement): string | null {
  const participantId = tile.id;
  const explicit = participantId ? document.getElementById(`${participantId}_name`) : null;
  const displayName = tile.querySelector<HTMLElement>('.displayname');

  return normalizeSpeakerName(
    explicit?.textContent || displayName?.textContent || null,
  );
}

function extractEndpointIdFromParticipantId(participantId: string): string {
  return participantId.replace(/^participant_/i, '').replace(/-(?:a|v)\d+$/i, '');
}

function extractEndpointIdFromStreamId(streamId: string): string | null {
  const endpointMatch = /^([a-z0-9-]+?)-(?:audio|video)-\d+-\d+$/i.exec(streamId);
  return endpointMatch?.[1] || null;
}

function collectEndpointOwners(): Map<string, PachcaTrackOwner> {
  const endpointOwners = new Map<string, PachcaTrackOwner>();
  const tiles = document.querySelectorAll<HTMLElement>('[id^="participant_"]');

  tiles.forEach((tile) => {
    const participantId = tile.id;
    if (!participantId || participantId.endsWith('_name')) return;

    const endpoint = extractEndpointIdFromParticipantId(participantId);
    if (!endpoint) return;

    if (!endpointOwners.has(endpoint)) {
      endpointOwners.set(endpoint, {
        participantId: participantId.startsWith('participant_') ? `participant_${endpoint}` : participantId,
        speaker: getSpeakerFromTile(tile),
      });
    }
  });

  return endpointOwners;
}

function extractOwnerByTrackId(): Map<string, PachcaTrackOwner> {
  const result = new Map<string, PachcaTrackOwner>();
  const endpointOwners = collectEndpointOwners();

  const registryMediaEls = document.querySelectorAll<HTMLMediaElement>(WEBRTC_REGISTRY_SELECTOR);
  registryMediaEls.forEach((mediaEl) => {
    const stream = mediaEl.srcObject;
    if (!(stream instanceof MediaStream)) return;

    const streamId = mediaEl.getAttribute('data-stream-id') || stream.id || null;
    const endpoint = streamId ? extractEndpointIdFromStreamId(streamId) : null;
    if (!endpoint) return;

    const owner = endpointOwners.get(endpoint);
    if (!owner) return;

    stream.getAudioTracks().forEach((track) => {
      if (!track.id) return;
      result.set(track.id, owner);
    });
  });

  const tiles = document.querySelectorAll<HTMLElement>('.filmstrip__videos [id^="participant_"], [id^="participant_"]');

  tiles.forEach((tile) => {
    const participantId = tile.id;
    if (!participantId) return;

    const speaker = getSpeakerFromTile(tile);
    const mediaEls = tile.querySelectorAll<HTMLMediaElement>('video, audio');

    mediaEls.forEach((mediaEl) => {
      const stream = mediaEl.srcObject;
      if (!(stream instanceof MediaStream)) return;

      stream.getAudioTracks().forEach((track) => {
        if (!track.id) return;
          const normalizedParticipantId = participantId.startsWith('participant_')
            ? `participant_${extractEndpointIdFromParticipantId(participantId)}`
            : participantId;
          result.set(track.id, { participantId: normalizedParticipantId, speaker });
        });
      });
  });

  const globalMedia = document.querySelectorAll<HTMLMediaElement>('video, audio');
  globalMedia.forEach((mediaEl) => {
    const stream = mediaEl.srcObject;
    if (!(stream instanceof MediaStream)) return;

    const endpoint = extractEndpointIdFromStreamId(stream.id);
    if (!endpoint) return;

    const owner = endpointOwners.get(endpoint);
    if (!owner) return;

    stream.getAudioTracks().forEach((track) => {
      if (!track.id || result.has(track.id)) return;
      result.set(track.id, owner);
    });
  });

  return result;
}

export class PachcaTrackTranscriber {
  private audioContext: AudioContext | null = null;
  private capturesByTrackId = new Map<string, ActiveTrackCapture>();
  private ownerByTrackId = new Map<string, PachcaTrackOwner>();
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
  private preRollChunksByTrackId = new Map<string, BufferedTrackChunk[]>();
  private preRollBytesByTrackId = new Map<string, number>();

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

      const participantTiles = document.querySelectorAll('[id^="participant_"]').length;
      const mediaElements = document.querySelectorAll('video, audio').length;
      const mediaWithSrcObject = [...document.querySelectorAll<HTMLMediaElement>('video, audio')].filter(
        (el) => el.srcObject instanceof MediaStream,
      ).length;

      console.warn('[LiveScribe][Pachca][TrackTranscriber] no active track captures after start', {
        ownerMappings: this.ownerByTrackId.size,
        participantTiles,
        mediaElements,
        mediaWithSrcObject,
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

      console.log('[LiveScribe][Pachca][TrackTranscriber] chunk stats', {
        tracks: summary.length,
        summary,
      });
    }, 3000);
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
    this.preRollChunksByTrackId.clear();
    this.preRollBytesByTrackId.clear();
    this.lastMainWorldSnapshotSignature = null;
  }

  private attachWebRTCMainMessageListener(): void {
    if (this.webRTCMessageListenerAttached) return;

    window.addEventListener('message', this.handleMainWorldMessage);
    this.webRTCMessageListenerAttached = true;
    console.log('[LiveScribe][Pachca][TrackTranscriber] listening MAIN-world WebRTC snapshots');
  }

  private detachWebRTCMainMessageListener(): void {
    if (!this.webRTCMessageListenerAttached) return;

    window.removeEventListener('message', this.handleMainWorldMessage);
    this.webRTCMessageListenerAttached = false;
  }

  private handleMainWorldMessage = (event: MessageEvent): void => {
    const data = event.data;
    if (!data || data.source !== 'livescribe-pachca-webrtc-tracks' || data.type !== 'snapshot') {
      return;
    }

    const tracks = (data.tracks || []) as MainWorldWebRTCTrackSnapshot[];
    const signature = tracks
      .map((track) => `${track.trackId}|${track.streamId ?? 'none'}|${track.endpointId ?? 'none'}`)
      .sort()
      .join(';');

    if (signature === this.lastMainWorldSnapshotSignature) {
      return;
    }
    this.lastMainWorldSnapshotSignature = signature;

    console.log('[LiveScribe][Pachca][TrackTranscriber] MAIN-world snapshot', {
      reason: data.reason,
      tracks: tracks.length,
      sample: tracks.slice(0, 5),
    });
  };

  private async syncTracks(): Promise<void> {
    if (!this.running || !this.audioContext) return;

    this.ownerByTrackId = extractOwnerByTrackId();
    this.logTrackMapIfChanged();

    // refresh speaker names for active captures
    for (const [trackId, capture] of this.capturesByTrackId) {
      const owner = this.ownerByTrackId.get(trackId);
      if (owner) {
        capture.participantId = owner.participantId;
        capture.speaker = owner.speaker;
      }
    }

    for (const [trackId, owner] of this.ownerByTrackId) {
      if (this.capturesByTrackId.has(trackId)) continue;

      const track = this.findAudioTrackById(trackId);
      if (!track) {
        if (!this.missingTrackLogged.has(trackId)) {
          this.missingTrackLogged.add(trackId);
          console.warn('[LiveScribe][Pachca][TrackTranscriber] mapped owner but track not found in DOM/registry', {
            trackId,
            participantId: owner.participantId,
            speaker: owner.speaker,
          });
        }
        continue;
      }

      this.missingTrackLogged.delete(trackId);

      await this.startTrackCapture(track, owner);
    }
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
      const tilesCount = document.querySelectorAll('[id^="participant_"]').length;
      const mediaCount = document.querySelectorAll('video, audio').length;
      const mediaWithStream = [...document.querySelectorAll<HTMLMediaElement>('video, audio')].filter(
        (el) => el.srcObject instanceof MediaStream,
      ).length;
      const registryElements = document.querySelectorAll(WEBRTC_REGISTRY_SELECTOR).length;

      console.warn('[LiveScribe][Pachca][TrackTranscriber] no track owners detected', {
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

  private async startTrackCapture(track: MediaStreamTrack, owner: PachcaTrackOwner): Promise<void> {
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
    console.log('[LiveScribe][Pachca][TrackTranscriber] capture started', {
      trackId: track.id,
      participantId: owner.participantId,
      speaker: owner.speaker,
      muted: track.muted,
      readyState: track.readyState,
    });

    track.addEventListener('mute', () => {
      console.log('[LiveScribe][Pachca][TrackTranscriber] capture track muted', {
        trackId: track.id,
        participantId: capture.participantId,
        speaker: capture.speaker,
      });
    });

    track.addEventListener('unmute', () => {
      console.log('[LiveScribe][Pachca][TrackTranscriber] capture track unmuted', {
        trackId: track.id,
        participantId: capture.participantId,
        speaker: capture.speaker,
      });
    });

    track.addEventListener('ended', () => {
      console.log('[LiveScribe][Pachca][TrackTranscriber] capture track ended', {
        trackId: track.id,
        participantId: capture.participantId,
        speaker: capture.speaker,
      });
      this.preRollChunksByTrackId.delete(track.id);
      this.preRollBytesByTrackId.delete(track.id);
    });
  }

  private bufferPreRollChunk(trackId: string, chunk: ArrayBuffer): void {
    const clonedChunk = chunk.slice(0);
    const chunkInfo: BufferedTrackChunk = {
      chunk: clonedChunk,
      byteLength: clonedChunk.byteLength,
    };

    const chunks = this.preRollChunksByTrackId.get(trackId) || [];
    chunks.push(chunkInfo);
    this.preRollChunksByTrackId.set(trackId, chunks);

    const currentBytes = this.preRollBytesByTrackId.get(trackId) || 0;
    let totalBytes = currentBytes + chunkInfo.byteLength;

    while (chunks.length > 0 && totalBytes > PRE_ROLL_MAX_BYTES) {
      const removed = chunks.shift();
      if (!removed) break;
      totalBytes -= removed.byteLength;
    }

    this.preRollBytesByTrackId.set(trackId, Math.max(0, totalBytes));
  }

  private consumePreRollChunks(trackId: string): BufferedTrackChunk[] {
    const chunks = this.preRollChunksByTrackId.get(trackId) || [];
    this.preRollChunksByTrackId.delete(trackId);
    this.preRollBytesByTrackId.delete(trackId);
    return chunks;
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

    chrome.runtime.sendMessage({
      type: 'TRACK_AUDIO_CHUNK',
      sessionId: this.sessionId,
      participantId,
      speaker,
      sampleRate: 16000,
      channels: 1,
      chunk: base64,
    }).catch(() => {
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

    const lastLevelSentAt = this.lastLevelSentAtByTrackId.get(trackId) ?? 0;
    if (now - lastLevelSentAt >= AUDIO_LEVEL_SEND_INTERVAL_MS) {
      this.lastLevelSentAtByTrackId.set(trackId, now);
      chrome.runtime
        .sendMessage({
          type: 'TRACK_AUDIO_LEVEL',
          participantId,
          speaker,
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
      console.log('[LiveScribe][Pachca][TrackTranscriber] VAD opened', {
        trackId,
        participantId,
        speaker,
        rms: Number(signal.rms.toFixed(5)),
        peak: Number(signal.peak.toFixed(5)),
      });
    }

    if (vadDecision.closed) {
      console.log('[LiveScribe][Pachca][TrackTranscriber] VAD closed', {
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
      console.log('[LiveScribe][Pachca][TrackTranscriber] first chunk from track', {
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
          this.sendPcmChunkToOffscreen(preRollChunk.chunk, participantId, speaker);
        });
      }
    }

    this.sendPcmChunkToOffscreen(chunk, participantId, speaker);
  }
}
